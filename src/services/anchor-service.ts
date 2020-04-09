import Context from "../context";
import RequestService from "./request-service";

import Contextual from "../contextual";

import CID from "cids";
import { Ipfs } from "ipfs";
import ipfsClient from "ipfs-http-client";
import { Logger as logger } from "@overnightjs/logger";
import { RequestStatus as RS } from "../models/request-status";

import { config } from "node-config-ts";
import { CompareFunction, MergeFunction, Node, PathDirection } from "../merkle/merkle";
import { MerkleTree } from "../merkle/merkle-tree";
import { Anchor } from "../models/anchor";
import { getManager } from "typeorm";
import { Request } from "../models/request";
import BlockchainService from "./blockchain-service";
import Transaction from "../models/transaction";
import Utils from "../utils";

/**
 * Anchors CIDs to blockchain
 */
export default class AnchorService implements Contextual {
  private readonly ipfs: Ipfs;
  private readonly ipfsMerge: IpfsMerge;
  private readonly ipfsCompare: IpfsCompare;

  private requestService: RequestService;
  private blockchainService: BlockchainService;

  constructor() {
    this.ipfs = ipfsClient(config.ipfsConfig.host);
    this.ipfsMerge = new IpfsMerge(this.ipfs);
    this.ipfsCompare = new IpfsCompare();
  }

  setContext(context: Context): void {
    this.requestService = context.lookup('RequestService');
    this.blockchainService = context.lookup('BlockchainService');
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
    const reqs = await this.requestService.findByStatus(RS.PENDING);
    if (reqs.length === 0) {
      logger.Info('No pending CID requests found. Skipping anchor.');
      return;
    }
    // set to processing
    await this.updateReqs(RS.PROCESSING, 'Request is processing.', ...reqs);

    // filter old updates for same docIds
    const docReqMapping = new Map<string, Request>();
    for (const req of reqs) {
      const old = docReqMapping.get(req.docId);
      if (old == null) {
        docReqMapping.set(req.docId, req);
        continue;
      }
      docReqMapping.set(req.docId, old.createdAt < req.createdAt? req : old);
    }

    const validReqs:Array<Request> = [];
    for (const req of docReqMapping.values()) {
      validReqs.push(req);
    }

    const oldReqs = reqs.filter(r => !validReqs.includes(r));
    await this.updateReqs(RS.FAILED, 'Request failed. Staled request.', ...oldReqs);

    const pairs:Array<CidDocPair> = [];
    for (const req of validReqs) {
      pairs.push(new CidDocPair(new CID(req.cid), req.docId));
    }

    // create merkle tree
    const merkleTree: MerkleTree<CidDocPair> = await this._createMerkleTree(pairs);

    // make a blockchain transaction
    const tx: Transaction = await this.blockchainService.sendTransaction(merkleTree.getRoot().data.cid);
    const txHashCid = Utils.convertEthHashToCid('eth-tx', tx.txHash.slice(2));

    const anchorRepository = getManager().getRepository(Anchor);
    const ipfsAnchorProof = {
      blockNumber: tx.blockNumber,
      blockTimestamp: tx.blockTimestamp,
      root: merkleTree.getRoot().data.cid,
      chainId: tx.chain,
      txHash: txHashCid,
    };
    const ipfsProofCid = await this.ipfs.dag.put(ipfsAnchorProof);

    for (let index = 0; index < pairs.length; index++) {
      const request: Request = reqs[index];

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
      await this.updateReqs(RS.COMPLETED, 'CID successfully anchored.', request);
    }

    logger.Info('Anchoring successfully completed.');
  }

  /**
   * Updates one or more requests
   * @param reqs - one or more requests
   * @param status - request status
   * @param message - request message
   */
  private async updateReqs(status: RS, message: string, ...reqs: Array<Request>): Promise<void> {
    for (const req of reqs) {
      req.status = status;
      req.message = message;
      await this.requestService.save(req);
    }
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
