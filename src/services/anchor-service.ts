import Context from '../context';
import RequestService from './request-service';

import Contextual from '../contextual';

import CID from 'cids';
import { Ipfs } from 'ipfs';
import ipfsClient from 'ipfs-http-client';
import { Logger as logger } from '@overnightjs/logger';
import { RequestStatus } from '../models/request-status';

import { config } from 'node-config-ts';
import { CompareFunction, MergeFunction, Node, PathDirection } from '../merkle/merkle';
import { MerkleTree } from '../merkle/merkle-tree';
import { Anchor } from '../models/anchor';
import { getManager } from 'typeorm';
import { Request } from '../models/request';
import BlockchainService from './blockchain-service';
import Transaction from '../models/transaction';
import Utils from '../utils';

/**
 * Anchors CIDs to blockchain
 */
export default class AnchorService implements Contextual {
  private readonly ipfs: Ipfs;
  private readonly ipfsMerge: IpfsMerge;
  private readonly ipfsCompare: IpfsCompare;

  private requestSrv: RequestService;
  private blockchainSrv: BlockchainService;

  constructor() {
    this.ipfs = ipfsClient(config.ipfsConfig.host);
    this.ipfsMerge = new IpfsMerge(this.ipfs);
    this.ipfsCompare = new IpfsCompare();
  }

  setContext(context: Context): void {
    this.requestSrv = context.lookup('RequestService');
    this.blockchainSrv = context.lookup('BlockchainService');
  }

  /**
   * Gets anchor metadata
   * @param request - Request id
   */
  public async findByRequest(request: Request): Promise<Anchor> {
    return await getManager()
      .getRepository(Anchor)
      .createQueryBuilder('anchor')
      .leftJoinAndSelect("anchor.request", "request")
      .where('request.id = :requestId', { requestId: request.id })
      .getOne();
  }

  /**
   * Creates anchors for client requests
   */
  public async anchorRequests(): Promise<void> {
    const requests = await this.requestSrv.findByStatus(RequestStatus.PENDING);

    if (requests.length === 0) {
      logger.Info('No pending CID requests found. Skipping anchor.');
      return;
    }

    await this.requestSrv.updateStatus(RequestStatus.PENDING, RequestStatus.PROCESSING);

    const pairs = requests.map((r) => new CidDocPair(new CID(r.cid), r.docId));
    const merkleTree: MerkleTree<CidDocPair> = await this._createMerkleTree(pairs);

    const tx: Transaction = await this.blockchainSrv.sendTransaction(merkleTree.getRoot().data.cid);

    const anchorRepository = getManager().getRepository(Anchor);

    const txHashCid = Utils.convertEthHashToCid('eth-tx', tx.txHash.slice(2));

    const ipfsAnchorProof = {
      blockNumber: tx.blockNumber,
      blockTimestamp: tx.blockTimestamp,
      root: merkleTree.getRoot().data.cid,
      chainId: tx.chain,
      txHash: txHashCid,
    };
    const ipfsProofCid = await this.ipfs.dag.put(ipfsAnchorProof);

    for (let index = 0; index < pairs.length; index++) {
      const request: Request = requests[index];

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
      await anchorRepository.save(anchor);

      request.status = RequestStatus.COMPLETED;
      await this.requestSrv.update(request);
    }

    logger.Info('Anchor completed.');
  }

  /**
   * Creates Merkle tree and adds merged docs to IPFS
   * @param pairs - CID-docId pairs
   * @private
   */
  private async _createMerkleTree(pairs: CidDocPair[]): Promise<MerkleTree<CidDocPair>> {
    const merkleTree: MerkleTree<CidDocPair> = new MerkleTree<CidDocPair>(this.ipfsMerge);
    await merkleTree.build(pairs);
    return merkleTree;
  }
}

/**
 * Paris CID with docId
 */
// tslint:disable-next-line:max-classes-per-file
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
// tslint:disable-next-line:max-classes-per-file
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
// tslint:disable-next-line:max-classes-per-file
class IpfsCompare implements CompareFunction<CidDocPair> {
  compare(left: Node<CidDocPair>, right: Node<CidDocPair>): number {
    return left.data.docId.localeCompare(right.data.docId);
  }
}
