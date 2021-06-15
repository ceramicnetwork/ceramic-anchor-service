import CID from "cids";

import { RequestStatus as RS } from "../models/request-status";

import { MerkleTree } from "../merkle/merkle-tree";
import { PathDirection, TreeMetadata } from '../merkle/merkle';

import { config } from "node-config-ts";
import { Transactional } from "typeorm-transactional-cls-hooked";

import { logger, logEvent } from '../logger';
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
import { StreamID, CommitID } from '@ceramicnetwork/streamid';
import { BloomMetadata, Candidate, IpfsLeafCompare, IpfsMerge } from '../merkle/merkle-objects';

const BATCH_SIZE = 100

/**
 * Anchors CIDs to blockchain
 */
@singleton()
export default class AnchorService {
  private readonly ipfsMerge: IpfsMerge;
  private readonly ipfsCompare: IpfsLeafCompare;
  private readonly bloomMetadata: BloomMetadata;

  constructor(
    @inject('blockchainService') private blockchainService?: BlockchainService,
    @inject('ipfsService') private ipfsService?: IpfsService,
    @inject('requestRepository') private requestRepository?: RequestRepository,
    @inject('ceramicService') private ceramicService?: CeramicService,
    @inject('anchorRepository') private anchorRepository?: AnchorRepository) {

    this.ipfsMerge = new IpfsMerge(this.ipfsService);
    this.ipfsCompare = new IpfsLeafCompare();
    this.bloomMetadata = new BloomMetadata();
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
    if (config.merkleDepthLimit == 0 || config.merkleDepthLimit == undefined) {
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
    logger.debug("Marking pending requests as processing")
    await this.requestRepository.updateRequests({ status: RS.PROCESSING, message: 'Request is processing.' }, requests);

    const candidates: Candidate[] = await this._findCandidates(requests);
    const validRequestIds = candidates.map(c => c.reqId)

    // filter valid requests
    const numInitialRequests = requests.length
    requests = requests.filter(r => validRequestIds.includes(r.id));
    if (requests.length === 0) {
      logger.debug("No CID to request. Skipping anchor.");
      return;
    }

    logger.imp(`Creating Merkle tree from ${candidates.length} selected records`);
    const merkleTree = await this._buildMerkleTree(candidates)

    // create and send ETH transaction
    logger.debug("Preparing to send transaction to put merkle root on blockchain")
    const tx: Transaction = await this.blockchainService.sendTransaction(merkleTree.getRoot().data.cid);

    // create proof on IPFS
    logger.debug("Creating IPFS anchor proof")
    const ipfsProofCid = await this._createIPFSProof(tx, merkleTree.getRoot().data.cid)

    // create anchor records on IPFS
    logger.debug("Creating anchor commit")
    const anchors = await this._createAnchorCommits(ipfsProofCid, merkleTree, requests);

    // Update the database to record the successful anchors
    logger.debug("Persisting results to local database")
    await this._persistAnchorResult(anchors)

    logEvent.anchor({
      type: 'anchorRequests',
      requestIds: requests.map(r => r.id),
      clashingRequestsCount: numInitialRequests - requests.length,
      validRequestsCount: requests.length,
      candidateCount: candidates.length,
      anchorCount: anchors.length
    });
    for (const candidate of merkleTree.getLeaves()) {
      logger.debug(`Successfully anchored CID ${candidate.cid.toString()} for stream ${candidate.stream.id.toString()}`)
    }
    logger.imp(`Service successfully anchored ${anchors.length} CIDs.`);
  }

  /**
   * Builds merkle tree
   * @param candidates
   * @private
   */
  async _buildMerkleTree(candidates: Candidate[]): Promise<MerkleTree<Candidate, TreeMetadata>> {
    try {
      const merkleTree = new MerkleTree<Candidate, TreeMetadata>(this.ipfsMerge, this.ipfsCompare, this.bloomMetadata, config.merkleDepthLimit);
      await merkleTree.build(candidates);
      return merkleTree
    } catch (e) {
      throw new Error('Merkle tree cannot be created: ' + e.toString());
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
    logger.debug('Anchor proof: ' + JSON.stringify(ipfsAnchorProof))
    const ipfsProofCid = await this.ipfsService.storeRecord(ipfsAnchorProof);
    logger.debug('Anchor proof cid: ' + ipfsProofCid.toString())
    return ipfsProofCid
  }

  /**
   * For each CID that was anchored, create a Ceramic AnchorCommit and publish it to IPFS.
   * @param ipfsProofCid - CID of the anchor proof on IPFS
   * @param merkleTree - Merkle tree instance
   * @param requests - Valid requests
   * @returns An array of Anchor objects that can be persisted in the database with the result
   * of each anchor request.
   * @private
   */
  async _createAnchorCommits(ipfsProofCid: CID, merkleTree: MerkleTree<Candidate, TreeMetadata>, requests: Request[]): Promise<Anchor[]> {
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

    await this.requestRepository.updateRequests({
        status: RS.COMPLETED,
        message: "CID successfully anchored."
    }, anchors.map(a => a.request));
  }

  /**
   * Takes a Request and returns a StreamID for the stream being anchored at the specific commit
   * that is the cid of the record from the anchor request
   * @param request - an anchor request
   * @returns A StreamID that can be used to load the stream at the moment in time of the record from
   *   the anchor request
   * @private
   */
  private _getRequestStreamID(request: Request): CommitID {
    const baseID = StreamID.fromString(request.streamId)
    return baseID.atCommit(request.cid)
  }

  /**
   * Find candidates for the anchoring
   * @private
   */
  async _findCandidates(requests: Request[]): Promise<Candidate[]> {
    logger.debug(`About to load candidate streams`)
    const candidates = await this._loadCandidateStreams(requests)
    logger.debug(`Successfully loaded candidate streams, about to apply conflict resolution to conflicting requests`)
    const [selectedCandidates, conflictingCandidates] = await this._selectValidCandidates(candidates)
    logger.debug(`About to fail requests rejected by conflict resolution`)
    await this._failConflictingRequests(requests, conflictingCandidates)

    return selectedCandidates;
  }

  /**
   * Takes an array of Requests, and returns Candidate objects for each Stream that could be
   * loaded successfully. Streams that couldn't be loaded successfully will be filtered out from
   * the result set. Also limits the size of the output set of Candidates based on the configured
   * merkleDepthLimit
   * @param requests - array of anchor requests
   * @returns - Array of 'Candidate' objects.
   */
  async _loadCandidateStreams(requests: Request[]): Promise<Candidate[]> {
    let streamCountLimit = requests.length // limiting to the number of requests is equivalent to no limit at all
    if (config.merkleDepthLimit > 0) {
      // The number of streams we are able to include in a single anchor batch is limited by the
      // max depth of the merkle tree.
      streamCountLimit = Math.pow(2, config.merkleDepthLimit)
    }

    const candidates = []
    let index = 0
    while (index < requests.length && candidates.length < streamCountLimit) {
      const batchSize = Math.min(BATCH_SIZE, streamCountLimit - candidates.length)
      const batchRequests = requests.slice(index, Math.min(index + batchSize, requests.length))

      const batchCandidates = await Promise.all(batchRequests.map((request) => { return this._loadCandidateForRequest(request) }))
      const validBatchCandidates = batchCandidates.filter((candidate) => { return candidate != null })
      candidates.push(...validBatchCandidates)
      index += batchSize
    }

    // If we didn't finish processing all the requests before hitting the stream limit, then
    // return the remaining unprocessed requests to the PENDING state.
    if (index < requests.length) {
      logger.warn('More than ' + candidates.length + ' candidate streams found, ' +
        'which is the limit that can fit in a merkle tree of depth ' + config.merkleDepthLimit +
        '. Returning unprocessed requests to PENDING status')

      const unprocessedRequests = requests.slice(index)
      await this.requestRepository.updateRequests({
        status: RS.PENDING,
        message: "Request returned to pending.",
      }, unprocessedRequests);
    }
    return candidates
  }

  /**
   * Takes a list of candidates and groups and groups them by StreamID
   * @param candidates
   * @returns Map of StreamIDs to Candidate objects
   */
  _groupCandidatesByStreamID(candidates: Candidate[]): Map<string, Candidate[]> {
    const groupedCandidates: Map<string, Candidate[]> = new Map();

    for (const candidate of candidates) {
        const candidateArr = groupedCandidates.get(candidate.streamId) || []
        candidateArr.push(candidate)
        groupedCandidates.set(candidate.streamId, candidateArr)
    }
    return groupedCandidates
  }

  /**
   * Given a Request, loads the corresponding Ceramic Stream and returns a Candidate object for
   * this Request. Also handles updating the requests database if loading the stream fails.
   * @param request
   */
  async _loadCandidateForRequest(request: Request): Promise<Candidate | null> {
    let streamId
    try {
      streamId = this._getRequestStreamID(request)
      const stream = await this.ceramicService.loadStream(streamId)
      if (!stream) {
        throw new Error(`No valid ceramic stream found with streamId ${streamId.toString()}`)
      }

      if (stream.tip.toString() != request.cid) {
        logger.warn(`When loading stream ${stream.id.toString()} at commit ${request.cid}, stream was returned at tip ${stream.tip.toString()}`)
      }

      return new Candidate(new CID(request.cid), request.id, stream);
    } catch (e) {
      logger.err(`Error while loading stream ${streamId?.baseID.toString()} at commit ${streamId?.commit.toString()}. ${e}`)
      await this.requestRepository.updateRequests({
        status: RS.FAILED,
        message: "Request has failed. " + e.toString(),
      }, [request]);
    }
  }

  /**
   * Selects which Candidate CID should be anchored for each streamId
   * @param candidates - List of Candidates each representing one anchor request
   * @return a tuple whose first element is an array of the Candidates that were selected for anchoring,
   *   and whose second element is an array of Candidates that were rejected by the conflict resolution rules
   */
  async _selectValidCandidates(candidates: Candidate[]): Promise<[Candidate[], Candidate[]]> {
    const groupedCandidates = this._groupCandidatesByStreamID(candidates)
    const selectedCandidates: Candidate[] = [];
    const conflictingCandidates: Candidate[] = []

    // Employ conflict resolution strategy to pick which cid to anchor when there are multiple
    // requests for the same streamId
    for (const streamId of groupedCandidates.keys()) {
      const candidates: Candidate[] = groupedCandidates.get(streamId);

      let selected: Candidate = null;

      for (const candidate of candidates) {
        if (selected == null) {
          selected = candidate
          continue
        }

        if (candidate.stream.state.log.length < selected.stream.state.log.length) {
          // 'selected' has a longer log than 'candidate', so reject 'candidate' and keep 'selected'
          conflictingCandidates.push(candidate)
        } else if (candidate.stream.state.log.length > selected.stream.state.log.length) {
          // 'candidate' has a longer log than 'selected', so reject 'selected' and select the candidate
          conflictingCandidates.push(selected)
          selected = candidate;
        } else {
          // There's a tie for log length, so we need to fall back to picking arbitrarily, but
          // deterministically. We match what js-ceramic does and pick the log with the lower CID.
          if (candidate.cid.bytes < selected.cid.bytes) {
            conflictingCandidates.push(selected)
            selected = candidate
          } else {
            conflictingCandidates.push(candidate)
          }
        }
      }
      if (selected) {
        selectedCandidates.push(selected);
      }
    }
    return [selectedCandidates, conflictingCandidates]
  }

  /**
   * Marks the anchor Requests that were rejected by conflict resolution as failed in the database.
   * @param requests
   * @param rejectedCandidates
   */
  async _failConflictingRequests(requests: Request[], rejectedCandidates: Candidate[]): Promise<void> {
    const rejectedRequestIds = rejectedCandidates.map(c => c.reqId)
    const rejectedRequests = requests.filter(r => rejectedRequestIds.includes(r.id))

    for (const rejected of rejectedCandidates) {
      console.debug(`Rejecting request to anchor CID ${rejected.cid.toString()} for stream ${rejected.stream.id.toString()} because there is a better CID to anchor for the same stream`)
    }

    if (rejectedRequests.length > 0) {
      await this.requestRepository.updateRequests({
        status: RS.FAILED,
        message: "Request has failed. There are conflicts with other requests for the same stream."
      }, rejectedRequests);
    }
  }
}
