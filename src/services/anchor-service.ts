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
import RequestRepository from "../repositories/request-repository";

import { IpfsService } from "./ipfs-service";
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
    const merged = [left.data.cid, right.data.cid];

    const mergedCid = await this.ipfsService.storeRecord(merged);
    logger.Info('Merkle node ' + mergedCid + ' created.');
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
    @inject('requestRepository') private requestRepository?: RequestRepository,
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
    logger.Imp('Anchoring pending requests...');

    let requests: Request[] = await this.requestRepository.findNextToProcess();
    if (requests.length === 0) {
      logger.Info("No pending CID requests found. Skipping anchor.");
      return;
    }
    await this.requestRepository.updateRequests({ status: RS.PROCESSING, message: 'Request is processing.' }, requests.map(r => r.id))

    const nonReachableRequestIds = await this._findUnreachableCids(requests);
    if (nonReachableRequestIds.length !== 0) {
      logger.Err("Some of the records will be discarded since they cannot be retrieved.");
      // discard non reachable ones
      await this.requestRepository.updateRequests({
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

    const candidates: Candidate[] = await this._findCandidates(requests);
    const clashingRequestIds = requests.filter(r => !candidates.map(c => c.reqId).includes(r.id)).map(r => r.id);
    if (clashingRequestIds.length > 0) {
      // discard clashing ones
      await this.requestRepository.updateRequests({
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

    logger.Imp('Creating Merkle tree from selected records.');
    const merkleTree = await this._buildMerkleTree(candidates)

    // create and send ETH transaction
    const tx: Transaction = await this.blockchainService.sendTransaction(merkleTree.getRoot().data.cid);

    // create proof on IPFS
    const ipfsProofCid = await this._createIPFSProof(tx, merkleTree.getRoot().data.cid)

    // create anchor records on IPFS
    const anchors = await this._createAnchorRecords(ipfsProofCid, merkleTree, candidates, requests);

    // Update the database to record the successful anchors
    await this._persistAnchorResult(anchors)

    logger.Imp(`Service successfully anchored ${anchors.length} CIDs.`);
  }

  /**
   * Finds CIDs which cannot be fetched.
   *
   * Note: if the record is signed, check its link as well
   * @param requests - Request list
   */
  public async _findUnreachableCids(requests: Array<Request>): Promise<Array<number>> {
    return (await Promise.all(requests.map(async (r) => {
      try {
        const record = await this.ipfsService.retrieveRecord(r.cid);
        if (record.link) {
          await this.ipfsService.retrieveRecord(record.link);
        }
        return null;
      } catch (e) {
        logger.Err('Failed to retrieve record. ' + e.message);
        return r.id;
      }
    }))).filter(id => id != null);
  }

  /**
   * Builds merkle tree
   * @param candidates
   * @private
   */
  async _buildMerkleTree(candidates: Candidate[]): Promise<MerkleTree<Candidate>> {
    try {
      const merkleTree = new MerkleTree<Candidate>(this.ipfsMerge, this.ipfsCompare);
      await merkleTree.build(candidates);
      return merkleTree
    } catch (e) {
      throw new Error('Merkle tree cannot be created: ' + e.message);
    }
  }

  /**
   * Creates a proof record for the entire merkle tree that was anchored in the given
   * ethereum transaction, publishes that record to IPFS, and returns the CID.
   * @param tx - ETH transaction
   * @param merkleRootCid - CID of the root of the merkle tree that was anchored in 'tx'
   */
  async _createIPFSProof(tx: Transaction, merkleRootCid: CID): Promise<CID> {
    const txHashCid = Utils.convertEthHashToCid("eth-tx", tx.txHash.slice(2));
    const ipfsAnchorProof = {
      blockNumber: tx.blockNumber,
      blockTimestamp: tx.blockTimestamp,
      root: merkleRootCid,
      chainId: tx.chain,
      txHash: txHashCid
    };
    const ipfsProofCid = await this.ipfsService.storeRecord(ipfsAnchorProof);
    return ipfsProofCid
  }

  /**
   * For each CID that was anchored, create a Ceramic AnchorRecord and publish it to IPFS.
   * @param ipfsProofCid - CID of the anchor proof on IPFS
   * @param merkleTree - Merkle tree instance
   * @param candidates - Merkle tree candidates
   * @param requests - Valid requests
   * @returns An array of Anchor objects that can be persisted in the database with the result
   * of each anchor request.
   * @private
   */
  async _createAnchorRecords(ipfsProofCid: CID, merkleTree: MerkleTree<Candidate>, candidates: Candidate[], requests: Request[]): Promise<Anchor[]> {
    const anchors: Anchor[] = [];
    for (let index = 0; index < candidates.length; index++) {
      const req: Request = requests.find(r => r.id === candidates[index].reqId);

      const anchor: Anchor = new Anchor();
      anchor.request = req;
      anchor.proofCid = ipfsProofCid.toString();

      const path = await merkleTree.getDirectPathFromRoot(index);
      anchor.path = path.map((p) => p === PathDirection.L ? 0 : 1).join("/");

      const ipfsAnchorRecord = { prev: new CID(req.cid), proof: ipfsProofCid, path: anchor.path };
      const anchorCid = await this.ipfsService.storeRecord(ipfsAnchorRecord);

      anchor.cid = anchorCid.toString();
      anchors.push(anchor);
    }
    return anchors
  }

  /**
   * Updates the anchor and request repositories in the local database with the results
   * of the anchor
   * @param anchors - Anchor objects to be persisted
   * @private
   */
  @Transactional()
  async _persistAnchorResult(anchors: Anchor[]): Promise<void> {
    await this.anchorRepository.createAnchors(anchors);

    await this.requestRepository.updateRequests(
      {
        status: RS.COMPLETED,
        message: "CID successfully anchored."
      },
      anchors.map(a => a.request.id));
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
        const did = config.ceramic.validateRecords ? await this.ceramicService.verifySignedRecord(request.cid) : null;

        const candidate = new Candidate(new CID(request.cid), request.docId, did, request.id);
        group[candidate.key] = group[candidate.key] ? [...group[candidate.key], candidate] : [candidate];
      } catch (e) {
        logger.Err(e, true);
        await this.requestRepository.updateRequests(
          {
            status: RS.FAILED,
            message: "Request has failed. " + e.message,
          },
          [request.id]);
      }
    }

    for (const key of Object.keys(group)) {
      const candidates: Candidate[] = group[key];

      let nonce = 0;
      let selected: Candidate = null;

      for (const candidate of candidates) {
        const record = await this.ipfsService.retrieveRecord(candidate.cid);

        let currentNonce;
        if (DoctypeUtils.isSignedRecord(record)) {
          const payload = await this.ipfsService.retrieveRecord(record.link);
          currentNonce = payload.header?.nonce || 0;
        } else {
          currentNonce = record.header?.nonce || 0;
        }
        if (selected == null || currentNonce > nonce) {
          selected = candidate;
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
