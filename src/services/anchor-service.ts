import Context from '../context';
import RequestService from './request-service';

import Contextual from '../contextual';

import { IPFSApi } from "../declarations";

import CID from 'cids';
import { DoctypeUtils } from '@ceramicnetwork/ceramic-common';
import { Logger as logger } from '@overnightjs/logger';
import { RequestStatus as RS } from '../models/request-status';

import CeramicService from "./ceramic-service";
import { CompareFunction, MergeFunction, Node, PathDirection } from '../merkle/merkle';
import { MerkleTree } from '../merkle/merkle-tree';
import { Anchor } from '../models/anchor';
import { getManager } from 'typeorm';
import { Request } from '../models/request';
import { BlockchainService } from './blockchain/blockchain-service';
import Transaction from '../models/transaction';
import Utils from '../utils';
import { config } from "node-config-ts";

class Candidate {
  public cid: CID;
  public docId: string;

  public did: string;
  public reqId: number;

  constructor(cid: CID, docId?: string, did?: string, reqId?: number) {
    this.cid = cid;
    this.docId = docId;
    this.did = did;
    this.reqId = reqId;
  }

  get key(): string {
    return this.docId + (this.did != null ? this.did : "");
  }

}

/**
 * Implements IPFS merge CIDs
 */
class IpfsMerge implements MergeFunction<Candidate> {
  private ipfs: IPFSApi;

  constructor(ipfs: IPFSApi) {
    this.ipfs = ipfs;
  }

  async merge(left: Node<Candidate>, right: Node<Candidate>): Promise<Node<Candidate>> {
    const merged = {
      L: left.data.cid,
      R: right.data.cid,
    };

    const mergedCid = await this.ipfs.dag.put(merged);
    return new Node<Candidate>(new Candidate(mergedCid), left, right);
  }
}

/**
 * Implements IPFS merge CIDs
 */
class IpfsLeafCompare implements CompareFunction<Candidate> {
  compare(left: Node<Candidate>, right: Node<Candidate>): number {
    return left.data.key.localeCompare(right.data.key);
  }
}

/**
 * Anchors CIDs to blockchain
 */
export default class AnchorService implements Contextual {
  private ipfsMerge: IpfsMerge;
  private ipfsCompare: IpfsLeafCompare;

  private requestService: RequestService;
  private ceramicService: CeramicService;
  private blockchainService: BlockchainService;

  /**
   * Initialize the service
   */
  public async init(): Promise<void> {
    this.ipfsMerge = new IpfsMerge(this.ceramicService.ipfs);
    this.ipfsCompare = new IpfsLeafCompare();
  }

  /**
   * Sets dependencies
   * @param context - Application context
   */
  setContext(context: Context): void {
    this.blockchainService = context.getSelectedBlockchainService();

    this.ceramicService = context.lookup('CeramicService');
    this.requestService = context.lookup('RequestService');
  }

  public async getChainId(): Promise<string> {
    return this.blockchainService.chainId
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
    let candidates = await this._findCandidates(reqs);
    const validReqIds = candidates.map(p => p.reqId);
    const discardedReqs = reqs.filter(r => !validReqIds.includes(r.id));

    if (discardedReqs.length > 0) {
      // update discarded requests
      await this.requestService.update({
        status: RS.FAILED,
        message: 'Request has failed. There are conflicts with other requests for the same document and DID.',
      }, discardedReqs.map(r => r.id));
    }

    // create merkle tree
    const merkleTree: MerkleTree<Candidate> = await this._createMerkleTree(candidates);
    candidates = merkleTree.getLeaves();

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
      const ipfsProofCid = await this.ceramicService.ipfs.dag.put(ipfsAnchorProof);

      const anchors: Anchor[] = [];
      for (let index = 0; index < candidates.length; index++) {
        const request: Request = reqs.find(r => r.id === candidates[index].reqId);

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
        const anchorCid = await this.ceramicService.ipfs.dag.put(ipfsAnchorRecord);

        anchor.cid = anchorCid.toString();
        anchors.push(anchor);
      }
      // create anchor records
      await anchorRepository.save(anchors);

      await this.requestService.update({
        status: RS.COMPLETED,
        message: 'CID successfully anchored.',
      }, validReqIds, txEntityManager);

      logger.Imp(`Service successfully anchored ${validReqIds.length} CIDs.`);
    });
  }

  /**
   * Find candidates for the anchoring
   * @private
   */
  async _findCandidates(requests: Request[]): Promise<Candidate[]> {
    const result: Candidate[] = [];
    const group: Record<string, Candidate[]> = {};

    let req = null;
    for (let index = 0; index < requests.length; index++) {
      try {
        req = requests[index];
        let did = null;
        if (config.ceramic.validateRecords) {
          const record = (await this.ceramicService.ipfs.dag.get(req.cid)).value;
          did = await this.ceramicService.verifySignedRecord(record);
        }

        const candidate = new Candidate(new CID(req.cid), req.docId, did, req.id);
        if (!group[candidate.key]) {
          group[candidate.key] = []
        }
        group[candidate.key].push(candidate)
      } catch (e) {
        logger.Err(e, true);
        await this.requestService.update({ status: RS.FAILED, message: 'Request has failed. Invalid signature.'}, [req.id]);
      }
    }

    for (const key of Object.keys(group)) {
      const candidates: Candidate[] = group[key];

      let nonce = 0;
      let selected: Candidate = null;

      for (const pair of candidates) {
        const record = (await this.ceramicService.ipfs.dag.get(pair.cid)).value;

        let currentNonce;
        if (DoctypeUtils.isSignedRecord(record)) {
          const payload = (await this.ceramicService.ipfs.dag.get(record.link)).value;
          currentNonce = payload.header?.nonce || 0;
        } else {
          currentNonce = record.header?.nonce || 0;
        }
        if (selected == null || currentNonce > nonce) {
          selected = pair;
          nonce = currentNonce;
        }
      }
      result.push(selected);
    }
    return result
  }

  /**
   * Creates Merkle tree and adds merged docs to IPFS
   * @param pairs - CID-docId pairs
   * @private
   */
  private async _createMerkleTree(pairs: Candidate[]): Promise<MerkleTree<Candidate>> {
    const merkleTree: MerkleTree<Candidate> = new MerkleTree<Candidate>(this.ipfsMerge, this.ipfsCompare);
    await merkleTree.build(pairs);
    return merkleTree;
  }
}
