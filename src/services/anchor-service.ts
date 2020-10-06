import Context from '../context';
import RequestService from './request-service';

import Contextual from '../contextual';

import CID from 'cids';
import { Ipfs } from 'ipfs';
import ipfsClient from 'ipfs-http-client';
import { Logger as logger } from '@overnightjs/logger';
import { RequestStatus as RS } from '../models/request-status';

import dagJose from 'dag-jose'
// @ts-ignore
import multiformats from 'multiformats/basics'
// @ts-ignore
import legacy from 'multiformats/legacy'

import { config } from 'node-config-ts';
import { CompareFunction, MergeFunction, Node, PathDirection } from '../merkle/merkle';
import { MerkleTree } from '../merkle/merkle-tree';
import { Anchor } from '../models/anchor';
import { getManager } from 'typeorm';
import { Request } from '../models/request';
import { BlockchainService } from './blockchain/blockchain-service';
import Transaction from '../models/transaction';
import Utils from '../utils';

/**
 * Paris CID with docId
 */
class CidDocPair {
  public cid: CID;
  public docId: string;

  constructor(cid: CID, docId?: string) {
    this.cid = cid;
    this.docId = docId;
  }
}

/**
 * Implements IPFS merge CIDs
 */
class IpfsMerge implements MergeFunction<CidDocPair> {
  private ipfs: Ipfs;

  constructor(ipfs: Ipfs) {
    this.ipfs = ipfs;
  }

  async merge(left: Node<CidDocPair>, right: Node<CidDocPair>): Promise<Node<CidDocPair>> {
    const merged = {
      L: left.data.cid,
      R: right.data.cid,
    };

    const mergedCid = await this.ipfs.dag.put(merged);
    return new Node<CidDocPair>(new CidDocPair(mergedCid), left, right);
  }
}

/**
 * Implements IPFS merge CIDs
 */
class IpfsCompare implements CompareFunction<CidDocPair> {
  compare(left: Node<CidDocPair>, right: Node<CidDocPair>): number {
    return left.data.docId.localeCompare(right.data.docId);
  }
}

/**
 * Anchors CIDs to blockchain
 */
export default class AnchorService implements Contextual {
  public ipfs: Ipfs;
  private readonly ipfsMerge: IpfsMerge;
  private readonly ipfsCompare: IpfsCompare;

  private requestService: RequestService;
  private blockchainService: BlockchainService;

  constructor() {
    this.ipfsMerge = new IpfsMerge(this.ipfs);
    this.ipfsCompare = new IpfsCompare();
  }

  /**
   * Initialize the service
   */
  public async init(): Promise<void> {
    multiformats.multicodec.add(dagJose);
    const format = legacy(multiformats, dagJose.name);

    this.ipfs = ipfsClient({ url: config.ipfsConfig.host, ipld: { formats: [format] } })
  }

  /**
   * Sets dependencies
   * @param context - Application context
   */
  setContext(context: Context): void {
    this.blockchainService = context.getSelectedBlockchainService();
    this.requestService = context.lookup('RequestService');
  }

  /**
   * Gets anchor metadata
   * @param request - Request id
   */
  public async findByRequest(request: Request): Promise<Anchor> {
    return await getManager()
      .getRepository(Anchor)
      .createQueryBuilder('anchor')
      .leftJoinAndSelect('anchor.request', 'request')
      .where('request.id = :requestId', { requestId: request.id })
      .getOne();
  }

  /**
   * Creates anchors for client requests
   */
  public async anchorRequests(): Promise<void> {
    let reqs: Request[] = [];
    await getManager().transaction(async txEntityManager => {
      reqs = await this.requestService.findNextToProcess(txEntityManager);
      if (reqs.length === 0) {
        return;
      }
      await this.requestService.update({
        status: RS.PROCESSING,
        message: 'Request is processing.'
      }, reqs.map(r => r.id), txEntityManager);
    });

    if (reqs.length === 0) {
      logger.Info('No pending CID requests found. Skipping anchor.');
      return;
    }

    // filter old updates for same docIds
    const docReqMapping = new Map<string, Request>();
    for (const req of reqs) {
      const old = docReqMapping.get(req.docId);
      if (old == null) {
        docReqMapping.set(req.docId, req);
        continue;
      }
      docReqMapping.set(req.docId, old.createdAt < req.createdAt ? req : old);
    }

    const validReqs: Request[] = [];
    for (const req of docReqMapping.values()) {
      validReqs.push(req);
    }

    const oldReqs = reqs.filter((r) => !validReqs.includes(r));

    if (oldReqs.length > 0) {
      // update failed requests
      await this.requestService.update({
        status: RS.FAILED,
        message: 'Request failed. Staled request.',
      }, oldReqs.map(r => r.id));
    }

    let leaves: CidDocPair[] = [];
    for (const req of validReqs) {
      leaves.push(new CidDocPair(new CID(req.cid), req.docId));
    }

    // create merkle tree
    const merkleTree: MerkleTree<CidDocPair> = await this._createMerkleTree(leaves);
    leaves = merkleTree.getLeaves();

    // make a blockchain transaction
    const tx: Transaction = await this.blockchainService.sendTransaction(merkleTree.getRoot().data.cid);
    const txHashCid = Utils.convertEthHashToCid('eth-tx', tx.txHash.slice(2));

    // run in transaction
    await getManager().transaction(async txEntityManager => {
      const anchorRepository = txEntityManager.getRepository(Anchor);
      const ipfsAnchorProof = {
        blockNumber: tx.blockNumber,
        blockTimestamp: tx.blockTimestamp,
        root: merkleTree.getRoot().data.cid,
        chainId: tx.chain,
        txHash: txHashCid,
      };
      const ipfsProofCid = await this.ipfs.dag.put(ipfsAnchorProof);

      const anchors: Anchor[] = [];
      for (let index = 0; index < leaves.length; index++) {
        const request: Request = validReqs.find(r => r.cid === leaves[index].cid.toString());

        const anchor: Anchor = new Anchor();
        anchor.request = request;
        anchor.proofCid = ipfsProofCid.toString();

        const path = await merkleTree.getDirectPathFromRoot(index);
        anchor.path = path.map((p) => PathDirection[p].toString()).join('/');

        const ipfsAnchorRecord = {
          prev: new CID(request.cid),
          proof: ipfsProofCid,
          path: anchor.path,
        };
        const anchorCid = await this.ipfs.dag.put(ipfsAnchorRecord);

        anchor.cid = anchorCid.toString();
        anchors.push(anchor);
      }
      // create anchor records
      await anchorRepository.save(anchors);

      await this.requestService.update({
        status: RS.COMPLETED,
        message: 'CID successfully anchored.',
      }, validReqs.map(r => r.id), txEntityManager);

      logger.Imp(`Service successfully anchored ${validReqs.length} CIDs.`);
    });
  }

  /**
   * Creates Merkle tree and adds merged docs to IPFS
   * @param pairs - CID-docId pairs
   * @private
   */
  private async _createMerkleTree(pairs: CidDocPair[]): Promise<MerkleTree<CidDocPair>> {
    const merkleTree: MerkleTree<CidDocPair> = new MerkleTree<CidDocPair>(this.ipfsMerge, this.ipfsCompare);
    await merkleTree.build(pairs);
    return merkleTree;
  }
}
