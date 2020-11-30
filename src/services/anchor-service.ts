import CID from "cids";

import { DoctypeUtils } from "@ceramicnetwork/common";
import { Logger as logger } from "@overnightjs/logger";
import { RequestStatus as RS } from "../models/request-status";

import { MerkleTree } from "../merkle/merkle-tree";
import { CompareFunction, MergeFunction, Node, PathDirection } from "../merkle/merkle";

import { config } from "node-config-ts";
import { Transactional } from "typeorm-transactional-cls-hooked";

import Utils from "../utils";
import { Anchor } from "../models/anchor";
import { Request } from "../models/request";
import Transaction from "../models/transaction";
import AnchorRepository from "../repositories/anchor-repository";

import { IpfsService } from "./ipfs-service";
import RequestService from "./request-service";
import CeramicService from "./ceramic-service";
import BlockchainService from "./blockchain/blockchain-service";
import { inject, singleton } from "tsyringe";

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
  private ipfsService: IpfsService;

  constructor(ipfsService: IpfsService) {
    this.ipfsService = ipfsService;
  }

  async merge(left: Node<Candidate>, right: Node<Candidate>): Promise<Node<Candidate>> {
    const merged = {
      L: left.data.cid,
      R: right.data.cid
    };

    const mergedCid = await this.ipfsService.storeRecord(merged);
    logger.Info('Created Merkle node ' + mergedCid);
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
@singleton()
export default class AnchorService {
  private readonly ipfsMerge: IpfsMerge;
  private readonly ipfsCompare: IpfsLeafCompare;

  constructor(
    @inject('blockchainService') private blockchainService?: BlockchainService,
    @inject('ipfsService') private ipfsService?: IpfsService,
    @inject('requestService') private requestService?: RequestService,
    @inject('ceramicService') private ceramicService?: CeramicService,
    @inject('anchorRepository') private anchorRepository?: AnchorRepository) {

    this.ipfsMerge = new IpfsMerge(this.ipfsService);
    this.ipfsCompare = new IpfsLeafCompare();
  }

  /**
   * Finds anchor by request
   * @param request - Request instance
   */
  public async findByRequest(request: Request): Promise<Anchor> {
    return this.anchorRepository.findByRequest(request);
  }

  /**
   * Creates anchors for client requests
   */
  public async anchorRequests(): Promise<void> {
    let requests: Request[] = await this.requestService.findNextToProcess();
    if (requests.length === 0) {
      logger.Info("No pending CID requests found. Skipping anchor.");
      return;
    }

    const nonReachableRequestIds = await this.ipfsService.findUnreachableCids(requests);
    if (nonReachableRequestIds.length !== 0) {
      logger.Err("Some of the records will be discarded since they cannot be retrieved.");
      // discard non reachable ones
      await this.requestService.updateRequests({
        status: RS.FAILED,
        message: "Request has failed. Record is not reachable by CAS IPFS service."
      }, nonReachableRequestIds);
    }

    // filter valid requests
    requests = requests.filter(r => !nonReachableRequestIds.includes(r.id));
    if (requests.length === 0) {
      logger.Info("No CID to request. Skipping anchor.");
      return;
    }

    let candidates: Candidate[] = await this._findCandidates(requests);
    const clashingRequestIds = requests.filter(r => !candidates.map(p => p.reqId).includes(r.id)).map(r => r.id);
    if (clashingRequestIds.length > 0) {
      // discard clashing ones
      await this.requestService.updateRequests({
        status: RS.FAILED,
        message: "Request has failed. There are conflicts with other requests for the same document and DID."
      }, clashingRequestIds);
    }

    // filter valid requests
    requests = requests.filter(r => !clashingRequestIds.includes(r.id));
    if (requests.length === 0) {
      logger.Info("No CID to request. Skipping anchor.");
      return;
    }

    let merkleTree: MerkleTree<Candidate>;
    try {
      logger.Imp('Creating Merkle tree from selected records.');
      merkleTree = new MerkleTree<Candidate>(this.ipfsMerge, this.ipfsCompare);
      await merkleTree.build(candidates);
      candidates = merkleTree.getLeaves();
    } catch (e) {
      throw new Error('Merkle tree cannot be created. ' + e.message);
    }

    // create and send ETH transaction
    const tx: Transaction = await this.blockchainService.sendTransaction(merkleTree.getRoot().data.cid);
    const txHashCid = Utils.convertEthHashToCid("eth-tx", tx.txHash.slice(2));

    // create proofs on IPFS
    await this._createIPFSProofs(tx, txHashCid, merkleTree, candidates, requests);
  }

  /**
   * Creates IPFS record proofs
   * @param tx - ETH transaction
   * @param txHashCid - Transaction hash CID
   * @param merkleTree - Merkle tree instance
   * @param candidates - Merkle tree candidates
   * @param requests - Valid requests
   * @private
   */
  @Transactional()
  async _createIPFSProofs(tx: Transaction, txHashCid: CID, merkleTree: MerkleTree<Candidate>, candidates: Candidate[], requests: Request[]): Promise<void> {
    logger.Imp('Create IPFS proofs.');
    const ipfsAnchorProof = {
      blockNumber: tx.blockNumber,
      blockTimestamp: tx.blockTimestamp,
      root: merkleTree.getRoot().data.cid,
      chainId: tx.chain,
      txHash: txHashCid
    };
    const ipfsProofCid = await this.ipfsService.storeRecord(ipfsAnchorProof);

    const anchors: Anchor[] = [];
    for (let index = 0; index < candidates.length; index++) {
      const req: Request = requests.find(r => r.id === candidates[index].reqId);

      const anchor: Anchor = new Anchor();
      anchor.request = req;
      anchor.proofCid = ipfsProofCid.toString();

      const path = await merkleTree.getDirectPathFromRoot(index);
      anchor.path = path.map((p) => PathDirection[p].toString()).join("/");

      const ipfsAnchorRecord = { prev: new CID(req.cid), proof: ipfsProofCid, path: anchor.path };
      const anchorCid = await this.ipfsService.storeRecord(ipfsAnchorRecord);

      anchor.cid = anchorCid.toString();
      anchors.push(anchor);
    }
    // create anchor records
    await this.anchorRepository.createAnchors(anchors);

    await this.requestService.updateRequests(
      {
        status: RS.COMPLETED,
        message: "CID successfully anchored."
      },
      requests.map(r => r.id));

    logger.Imp(`Service successfully anchored ${requests.length} CIDs.`);
  }

  /**
   * Find candidates for the anchoring
   * @private
   */
  async _findCandidates(requests: Request[]): Promise<Candidate[]> {
    const result: Candidate[] = [];
    const group: Record<string, Candidate[]> = {};

    let request = null;
    for (let index = 0; index < requests.length; index++) {
      try {
        request = requests[index];
        const record = await this.ipfsService.retrieveRecord(request.cid);
        const did = config.ceramic.validateRecords ? await this.ceramicService.verifySignedRecord(record) : null;

        const candidate = new Candidate(new CID(request.cid), request.docId, did, request.id);
        group[candidate.key] = group[candidate.key] ? [...group[candidate.key], candidate] : [candidate];
      } catch (e) {
        logger.Err(e, true);
        await this.requestService.updateRequests(
          {
            status: RS.FAILED,
            message: "Request has failed. Invalid signature."
          },
          [request.id]);
      }
    }

    for (const key of Object.keys(group)) {
      const candidates: Candidate[] = group[key];

      let nonce = 0;
      let selected: Candidate = null;

      for (const pair of candidates) {
        const record = await this.ipfsService.retrieveRecord(pair.cid);

        let currentNonce;
        if (DoctypeUtils.isSignedRecord(record)) {
          const payload = await this.ipfsService.retrieveRecord(record.link);
          currentNonce = payload.header?.nonce || 0;
        } else {
          currentNonce = record.header?.nonce || 0;
        }
        if (selected == null || currentNonce > nonce) {
          selected = pair;
          nonce = currentNonce;
        }
      }
      if (selected) {
        result.push(selected);
      }
    }
    return result;
  }
}
