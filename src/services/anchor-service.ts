import CID from "cids";

import { Doctype, DoctypeUtils } from '@ceramicnetwork/common';
import { RequestStatus as RS } from "../models/request-status";

import { MerkleTree } from "../merkle/merkle-tree";
import { CompareFunction, MergeFunction, Node, PathDirection } from "../merkle/merkle";

import { config } from "node-config-ts";
import { Transactional } from "typeorm-transactional-cls-hooked";

import { logger } from '../logger';
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
import DocID from '@ceramicnetwork/docid';

class Candidate {
  public readonly cid: CID;
  public readonly document: Doctype;
  public readonly reqId: number;

  constructor(cid: CID, reqId?: number, document?: Doctype) {
    this.cid = cid;
    this.reqId = reqId;
    this.document = document
  }

  get key(): string {
    return this.document.id.baseID.toString()
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
    logger.debug('Merkle node ' + mergedCid + ' created.');
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
   * If there are more pending requests than can fit into a single merkle tree (based on
   * config.merkleDepthLimit), then triggers an anchor, otherwise does nothing.
   * @returns whether or not an anchor was performed
   */
  public async anchorIfTooManyPendingRequests(): Promise<boolean> {
    if (!config.merkleDepthLimit) {
      // If there's no limit to the size of an anchor, then there's no such thing as "too many"
      // pending requests, and we can always wait for our next scheduled anchor.
      return false
    }

    const nodeLimit = Math.pow(2, config.merkleDepthLimit)
    const requests: Request[] = await this.requestRepository.findNextToProcess();
    if (requests.length > nodeLimit) {
      logger.imp("There are " + requests.length + " pending anchor requests, which is more "
        + "than can fit into a single anchor batch given our configured merkleDepthLimit of "
        + config.merkleDepthLimit + " (" + nodeLimit + " requests). Triggering an anchor early to "
        + "drain our queue")
      await this._anchorRequests(requests)
      return true
    }
    return false
  }

  /**
   * Creates anchors for client requests
   */
  public async anchorRequests(): Promise<void> {
    const requests: Request[] = await this.requestRepository.findNextToProcess();
    await this._anchorRequests(requests)
  }

  private async _anchorRequests(requests: Request[]): Promise<void> {
    logger.imp('Anchoring pending requests...');

    if (requests.length === 0) {
      logger.debug("No pending CID requests found. Skipping anchor.");
      return;
    }
    await this.requestRepository.updateRequests({ status: RS.PROCESSING, message: 'Request is processing.' }, requests.map(r => r.id))

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
      logger.debug("No CID to request. Skipping anchor.");
      return;
    }

    logger.imp('Creating Merkle tree from selected records.');
    const merkleTree = await this._buildMerkleTree(candidates)

    // create and send ETH transaction
    const tx: Transaction = await this.blockchainService.sendTransaction(merkleTree.getRoot().data.cid);

    // create proof on IPFS
    const ipfsProofCid = await this._createIPFSProof(tx, merkleTree.getRoot().data.cid)

    // create anchor records on IPFS
    const anchors = await this._createAnchorRecords(ipfsProofCid, merkleTree, requests);

    // Update the database to record the successful anchors
    await this._persistAnchorResult(anchors)

    logger.imp(`Service successfully anchored ${anchors.length} CIDs.`);
  }

  /**
   * Builds merkle tree
   * @param candidates
   * @private
   */
  async _buildMerkleTree(candidates: Candidate[]): Promise<MerkleTree<Candidate>> {
    try {
      if (config.merkleDepthLimit) {
        const nodeLimit = Math.pow(2, config.merkleDepthLimit)
        if (candidates.length > nodeLimit) {
          logger.warn('Found ' + candidates.length + ' valid candidates to anchor, but our '
            + 'configured merkle tree depth limit of ' + config.merkleDepthLimit
            + ' only permits ' + nodeLimit + ' nodes in a single merkle tree anchor proof. '
            + 'Anchoring the first ' + nodeLimit + ' candidates and leaving the rest for a future anchor batch');
          candidates = candidates.slice(0, nodeLimit)
        }
      }
      const merkleTree = new MerkleTree<Candidate>(this.ipfsMerge, this.ipfsCompare, config.merkleDepthLimit);
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
   * @param requests - Valid requests
   * @returns An array of Anchor objects that can be persisted in the database with the result
   * of each anchor request.
   * @private
   */
  async _createAnchorRecords(ipfsProofCid: CID, merkleTree: MerkleTree<Candidate>, requests: Request[]): Promise<Anchor[]> {
    const anchors: Anchor[] = [];
    const candidates = merkleTree.getLeaves()
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
   * Takes a Request and returns a DocID for the document being anchored at the specific commit
   * that is the cid of the record from the anchor request
   * @param request - an anchor request
   * @returns A DocID that can be used to load the document at the moment in time of the record from
   *   the anchor request
   * @private
   */
  private _getRequestDocID(request: Request): DocID {
    const baseID = DocID.fromString(request.docId)
    return DocID.fromOther(baseID, request.cid)
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

        const docId = this._getRequestDocID(request)
        const doc = await this.ceramicService.loadDocument(docId)
        if (!doc) {
          throw new Error(`No valid ceramic document found with docId ${docId.toString()}`)
        }

        const candidate = new Candidate(new CID(request.cid), request.id, doc);
        group[candidate.key] = group[candidate.key] ? [...group[candidate.key], candidate] : [candidate];
      } catch (e) {
        logger.err(e);
        await this.requestRepository.updateRequests(
          {
            status: RS.FAILED,
            message: "Request has failed. " + e.message,
          },
          [request.id]);
      }
    }

    // Employ conflict resolution strategy to pick which cid to anchor when there are multiple
    // requests for the same docId
    for (const key of Object.keys(group)) {
      const candidates: Candidate[] = group[key];

      let longestLog = 0;
      let selected: Candidate = null;

      for (const candidate of candidates) {
        const logLength = candidate.document.state.log.length
        if (selected == null || logLength > longestLog) {
          selected = candidate;
          longestLog = candidate.document.state.log.length;
        } else if (selected && logLength == longestLog) {
          // There's a tie for log length, so we need to fall back to picking arbitrarily, but
          // deterministically. We match what js-ceramic does and pick the log with the lower CID.
          if (candidate.cid < selected.cid) {
            selected = candidate
          }
        }
      }
      if (selected) {
        result.push(selected);
      }
    }
    return result;
  }
}
