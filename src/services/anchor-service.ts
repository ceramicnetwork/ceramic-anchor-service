import CID from 'cids'

import { RequestStatus as RS } from '../models/request-status'

import { MerkleTree } from '../merkle/merkle-tree'
import { PathDirection, TreeMetadata } from '../merkle/merkle'

import { Config } from 'node-config-ts'

import { logger, logEvent } from '../logger'
import Utils from '../utils'
import { Anchor } from '../models/anchor'
import { Request } from '../models/request'
import Transaction from '../models/transaction'
import AnchorRepository from '../repositories/anchor-repository'
import RequestRepository from '../repositories/request-repository'

import { IpfsService } from './ipfs-service'
import CeramicService from './ceramic-service'
import BlockchainService from './blockchain/blockchain-service'
import { inject, singleton } from 'tsyringe'
import { StreamID, CommitID } from '@ceramicnetwork/streamid'
import {
  BloomMetadata,
  Candidate,
  CIDHolder,
  IpfsLeafCompare,
  IpfsMerge,
} from '../merkle/merkle-objects'
import { Connection } from 'typeorm'

type RequestGroups = {
  alreadyAnchoredRequests: Request[]
  conflictingRequests: Request[]
  failedRequests: Request[]
  unprocessedRequests: Request[]
  acceptedRequests: Request[]
}

/**
 * Anchors CIDs to blockchain
 */
@singleton()
export default class AnchorService {
  private readonly ipfsMerge: IpfsMerge
  private readonly ipfsCompare: IpfsLeafCompare
  private readonly bloomMetadata: BloomMetadata

  constructor(
    @inject('blockchainService') private blockchainService?: BlockchainService,
    @inject('config') private config?: Config,
    @inject('ipfsService') private ipfsService?: IpfsService,
    @inject('requestRepository') private requestRepository?: RequestRepository,
    @inject('ceramicService') private ceramicService?: CeramicService,
    @inject('anchorRepository') private anchorRepository?: AnchorRepository,
    @inject('dbConnection') private connection?: Connection
  ) {
    this.ipfsMerge = new IpfsMerge(this.ipfsService)
    this.ipfsCompare = new IpfsLeafCompare()
    this.bloomMetadata = new BloomMetadata()
  }

  /**
   * If there are more pending requests than can fit into a single merkle tree (based on
   * config.merkleDepthLimit), then triggers an anchor, otherwise does nothing.
   * @returns whether or not an anchor was performed
   */
  public async anchorIfTooManyPendingRequests(): Promise<boolean> {
    if (this.config.merkleDepthLimit == 0 || this.config.merkleDepthLimit == undefined) {
      // If there's no limit to the size of an anchor, then there's no such thing as "too many"
      // pending requests, and we can always wait for our next scheduled anchor.
      return false
    }

    const nodeLimit = Math.pow(2, this.config.merkleDepthLimit)
    const requestLimit = 2 * nodeLimit
    const requests: Request[] = await this.requestRepository.findNextToProcess(requestLimit)
    if (requests.length > nodeLimit) {
      logger.imp(
        'There are at least ' +
          requests.length +
          ' pending anchor requests, which is more ' +
          'than can fit into a single anchor batch given our configured merkleDepthLimit of ' +
          this.config.merkleDepthLimit +
          ' (' +
          nodeLimit +
          ' requests). Triggering an anchor early to ' +
          'drain our queue'
      )
      await this._anchorRequests(requests)
      return true
    }
    return false
  }

  /**
   * Creates anchors for client requests
   */
  public async anchorRequests(): Promise<void> {
    logger.imp('Anchoring pending requests...')
    // We try to fill our batch with 2^merkleDepthLimit streams at the leaf nodes of the merkle tree.
    // To make sure we find enough requests on unique streamids to fill the batch, we pull in 100x
    // the number of requests as the number of unique streams we are looking for. If we *still*
    // don't find enough unique streams in all those requests, then we wind up with an under-full
    // batch.  More likely, we pull in more requests than we need, but the remainder will just
    // be picked up by the next anchor batch.
    const streamLimit = Math.pow(2, this.config.merkleDepthLimit)
    const requestLimit = streamLimit * 100
    logger.debug(`Loading requests from the database`)
    const requests: Request[] = await this.requestRepository.findNextToProcess(requestLimit)
    await this._anchorRequests(requests)
  }

  public async garbageCollectPinnedStreams(): Promise<void> {
    const requests: Request[] = await this.requestRepository.findRequestsToGarbageCollect()
    await this._garbageCollect(requests)
  }

  private async _anchorRequests(requests: Request[]): Promise<void> {
    if (requests.length === 0) {
      logger.debug('No pending CID requests found. Skipping anchor.')
      return
    }

    let streamCountLimit = 0 // 0 means no limit
    if (this.config.merkleDepthLimit > 0) {
      // The number of streams we are able to include in a single anchor batch is limited by the
      // max depth of the merkle tree.
      streamCountLimit = Math.pow(2, this.config.merkleDepthLimit)
    }
    const minStreamCount = this.config.minStreamCount || streamCountLimit / 2
    const [candidates, groupedRequests] = await this._findCandidates(
      requests,
      streamCountLimit,
      minStreamCount
    )
    if (candidates.length === 0) {
      logger.imp('No candidates found. Skipping anchor.')
      logger.debug(
        'Sleeping 10 minutes before shutting down to prevent constantly running empty anchor batches'
      )
      await Utils.delay(1000 * 60 * 10)
      logger.debug(`Sleep complete, shutting down`)
      return
    }

    logger.imp(`Creating Merkle tree from ${candidates.length} selected streams`)
    const merkleTree = await this._buildMerkleTree(candidates)

    // create and send ETH transaction
    logger.debug('Preparing to send transaction to put merkle root on blockchain')
    const tx: Transaction = await this.blockchainService.sendTransaction(
      merkleTree.getRoot().data.cid
    )

    // create proof on IPFS
    logger.debug('Creating IPFS anchor proof')
    const ipfsProofCid = await this._createIPFSProof(tx, merkleTree.getRoot().data.cid)

    // create anchor records on IPFS
    logger.debug('Creating anchor commits')
    const anchors = await this._createAnchorCommits(ipfsProofCid, merkleTree)

    // Update the database to record the successful anchors
    logger.debug('Persisting results to local database')
    const numAnchoredRequests = await this._persistAnchorResult(anchors, candidates)

    logger.imp(`Service successfully anchored ${anchors.length} CIDs.`)
    logEvent.anchor({
      type: 'anchorRequests',
      acceptedRequestsCount: groupedRequests.acceptedRequests.length,
      alreadyAnchoredRequestsCount: groupedRequests.alreadyAnchoredRequests.length,
      anchoredRequestsCount: numAnchoredRequests,
      conflictingRequestCount: groupedRequests.conflictingRequests.length,
      failedRequestsCount: groupedRequests.failedRequests.length,
      failedToPublishAnchorCommitCount: merkleTree.getLeaves().length - anchors.length,
      unprocessedRequestCount: groupedRequests.unprocessedRequests.length,
      candidateCount: candidates.length,
      anchorCount: anchors.length,
    })

    // Sleep 5 seconds before exiting the process to give time for the logs to flush.
    await Utils.delay(5000)
  }

  private async _garbageCollect(requests: Request[]): Promise<void> {
    const streamIds = new Set<string>()
    requests.forEach((request) => streamIds.add(request.streamId))

    logger.imp(
      `Garbage collecting ${streamIds.size} pinned Streams from ${requests.length} Requests`
    )

    const unpinnedStreams = new Set<string>()
    for (const streamIdStr of streamIds) {
      try {
        const streamId = StreamID.fromString(streamIdStr)
        await this.ceramicService.unpinStream(streamId)
        unpinnedStreams.add(streamIdStr)
        logger.debug(`Stream ${streamIdStr.toString()} successfully unpinned`)
      } catch (err) {
        logger.err(`Error unpinning Stream ${streamIdStr}: ${err}`)
      }
    }

    logger.imp(`Successfully unpinned ${unpinnedStreams.size} Streams`)

    const garbageCollectedRequests = requests.filter((request) =>
      unpinnedStreams.has(request.streamId)
    )

    await this.requestRepository.updateRequests({ pinned: false }, garbageCollectedRequests)

    logger.imp(`Successfully garbage collected ${garbageCollectedRequests.length} Requests`)
  }

  /**
   * Builds merkle tree
   * @param candidates
   * @private
   */
  async _buildMerkleTree(
    candidates: Candidate[]
  ): Promise<MerkleTree<CIDHolder, Candidate, TreeMetadata>> {
    try {
      const merkleTree = new MerkleTree<CIDHolder, Candidate, TreeMetadata>(
        this.ipfsMerge,
        this.ipfsCompare,
        this.bloomMetadata,
        this.config.merkleDepthLimit
      )
      await merkleTree.build(candidates)
      return merkleTree
    } catch (e) {
      throw new Error('Merkle tree cannot be created: ' + e.toString())
    }
  }

  /**
   * Creates a proof record for the entire merkle tree that was anchored in the given
   * ethereum transaction, publishes that record to IPFS, and returns the CID.
   * @param tx - ETH transaction
   * @param merkleRootCid - CID of the root of the merkle tree that was anchored in 'tx'
   */
  async _createIPFSProof(tx: Transaction, merkleRootCid: CID): Promise<CID> {
    const txHashCid = Utils.convertEthHashToCid('eth-tx', tx.txHash.slice(2))
    const ipfsAnchorProof = {
      blockNumber: tx.blockNumber,
      blockTimestamp: tx.blockTimestamp,
      root: merkleRootCid,
      chainId: tx.chain,
      txHash: txHashCid,
    }
    logger.debug('Anchor proof: ' + JSON.stringify(ipfsAnchorProof))
    const ipfsProofCid = await this.ipfsService.storeRecord(ipfsAnchorProof)
    logger.debug('Anchor proof cid: ' + ipfsProofCid.toString())
    return ipfsProofCid
  }

  /**
   * For each CID that was anchored, create a Ceramic AnchorCommit and publish it to IPFS.
   * @param ipfsProofCid - CID of the anchor proof on IPFS
   * @param merkleTree - Merkle tree instance
   * @returns An array of Anchor objects that can be persisted in the database with the result
   * of each anchor request.
   * @private
   */
  async _createAnchorCommits(
    ipfsProofCid: CID,
    merkleTree: MerkleTree<CIDHolder, Candidate, TreeMetadata>
  ): Promise<Anchor[]> {
    const candidates = merkleTree.getLeaves()
    const anchors = []

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]
      logger.debug(
        `Creating anchor commit #${i + 1} of ${
          candidates.length
        }: stream id ${candidate.streamId.toString()} at commit CID ${candidate.cid}`
      )
      const anchor = await this._createAnchorCommit(candidate, i, ipfsProofCid, merkleTree)
      if (anchor) {
        anchors.push(anchor)
      }
    }

    return anchors
  }

  /**
   * Helper function for _createAnchorCommits that creates a single anchor commit for a single candidate.
   * @param candidate
   * @param candidateIndex - index of the candidate within the leaves of the merkle tree.
   * @param ipfsProofCid
   * @param merkleTree
   */
  async _createAnchorCommit(
    candidate: Candidate,
    candidateIndex: number,
    ipfsProofCid: CID,
    merkleTree: MerkleTree<CIDHolder, Candidate, TreeMetadata>
  ): Promise<Anchor | null> {
    const anchor: Anchor = new Anchor()
    anchor.request = candidate.newestAcceptedRequest
    anchor.proofCid = ipfsProofCid.toString()

    const path = await merkleTree.getDirectPathFromRoot(candidateIndex)
    anchor.path = path.map((p) => (p === PathDirection.L ? 0 : 1)).join('/')

    const ipfsAnchorCommit = {
      id: candidate.streamId.cid,
      prev: candidate.cid,
      proof: ipfsProofCid,
      path: anchor.path,
    }

    try {
      // TODO(#548): Publish anchor commits via Ceramic
      // const anchorCid = await this.ceramicService.publishAnchorCommit(
      //   candidate.streamId,
      //   ipfsAnchorCommit
      // )
      const anchorCid = await this.ipfsService.storeRecord(ipfsAnchorCommit)
      anchor.cid = anchorCid.toString()

      logger.debug(
        `Created anchor commit with CID ${anchorCid.toString()} for stream ${candidate.streamId.toString()}`
      )
    } catch (err) {
      const msg = `Error publishing anchor commit of commit ${
        candidate.cid
      } for stream ${candidate.streamId.toString()}: ${err}`
      logger.err(msg)
      await this.requestRepository.updateRequests(
        { status: RS.FAILED, message: msg },
        candidate.acceptedRequests
      )
      candidate.failAllRequests()
      return null
    }
    return anchor
  }

  /**
   * Updates the anchor and request repositories in the local database with the results
   * of the anchor
   * @param anchors - Anchor objects to be persisted
   * @param candidates - Candidate objects for the Streams that had anchor attempts. Note that some
   *   of them may have encountered failures during the anchor attempt.
   * @returns The number of successfully anchored requests
   * @private
   */
  async _persistAnchorResult(anchors: Anchor[], candidates: Candidate[]): Promise<number> {
    // filter to requests for streams that were actually anchored successfully
    const acceptedRequests = []
    for (const candidate of candidates) {
      acceptedRequests.push(...candidate.acceptedRequests)
    }

    const queryRunner = this.connection.createQueryRunner()
    await queryRunner.startTransaction()
    try {
      await this.anchorRepository.createAnchors(anchors, queryRunner.manager)

      await this.requestRepository.updateRequests(
        {
          status: RS.COMPLETED,
          message: 'CID successfully anchored.',
        },
        acceptedRequests,
        queryRunner.manager
      )

      await queryRunner.commitTransaction()
    } catch (err) {
      await queryRunner.rollbackTransaction()
      throw err
    } finally {
      await queryRunner.release()
    }

    return acceptedRequests.length
  }

  /**
   * After loading Candidate streams, we are left with several groups of requests that for various
   * reasons will not be included in this batch.  This function takes those requests and updates
   * the database for them as needed.
   * @param requests
   */
  async _updateNonSelectedRequests(requests: RequestGroups) {
    const {
      alreadyAnchoredRequests,
      conflictingRequests,
      failedRequests,
      unprocessedRequests,
    } = requests

    if (failedRequests.length > 0) {
      logger.debug(
        `About to fail ${failedRequests.length} requests for CIDs that could not be loaded`
      )
      await this.requestRepository.updateRequests(
        {
          status: RS.FAILED,
          message: 'Request has failed. Commit could not be loaded',
        },
        failedRequests
      )
    }

    if (conflictingRequests.length > 0) {
      logger.debug(
        `About to fail ${conflictingRequests.length} requests rejected by conflict resolution`
      )
      for (const rejected of conflictingRequests) {
        console.warn(
          `Rejecting request to anchor CID ${rejected.cid.toString()} for stream ${
            rejected.streamId
          } because it was rejected by Ceramic's conflict resolution rules`
        )
      }
      await this.requestRepository.updateRequests(
        {
          status: RS.FAILED,
          message: 'Request has failed. Updated was rejected by conflict resolution.',
        },
        conflictingRequests
      )
    }

    if (alreadyAnchoredRequests.length > 0) {
      logger.debug(
        `Marking ${alreadyAnchoredRequests.length} requests for CIDs that have already been anchored as COMPLETED`
      )
      await this.requestRepository.updateRequests(
        {
          status: RS.COMPLETED,
          message: 'Request was already anchored',
        },
        alreadyAnchoredRequests
      )
    }

    if (unprocessedRequests.length > 0) {
      logger.debug(
        `There were ${unprocessedRequests.length} unprocessed requests that didn't make it into this batch.  Leaving them in PENDING state as they were.`
      )
    }
  }

  /**
   * Find candidates for the anchoring. Also updates the Request database for the Requests that we
   * already know at this point have failed, already been anchored, or were excluded from processing
   * in this batch.
   * @private
   */
  async _findCandidates(
    requests: Request[],
    candidateLimit: number,
    minStreamCount: number
  ): Promise<[Candidate[], RequestGroups]> {
    logger.debug(`Grouping requests by stream`)
    const candidates = AnchorService._buildCandidates(requests)

    if (candidates.length < minStreamCount) {
      logger.imp(
        `Only ${candidates.length} candidate streams found, which is less than half of the ${candidateLimit} desired. Skipping anchor`
      )
      return [[], null]
    }

    logger.debug(`Loading candidate streams`)
    const groupedRequests = await this._loadCandidateStreams(candidates, candidateLimit)
    await this._updateNonSelectedRequests(groupedRequests)

    const candidatesToAnchor = candidates.filter((candidate) => {
      return candidate.shouldAnchor()
    })

    if (candidatesToAnchor.length > 0) {
      for (const candidate of candidates) {
        groupedRequests.acceptedRequests.push(...candidate.acceptedRequests)
      }
      logger.debug(
        `Marking ${groupedRequests.acceptedRequests.length} pending requests as processing`
      )
      await this.requestRepository.updateRequests(
        { status: RS.PROCESSING, message: 'Request is processing.', pinned: true },
        groupedRequests.acceptedRequests
      )
    }

    return [candidatesToAnchor, groupedRequests]
  }

  /**
   * Groups requests on the same StreamID into single Candidate objects.
   * @param requests
   */
  static _buildCandidates(requests: Request[]): Candidate[] {
    const requestsByStream: Map<string, Request[]> = new Map()

    for (const request of requests) {
      let streamRequests = requestsByStream.get(request.streamId)
      if (!streamRequests) {
        streamRequests = []
        requestsByStream.set(request.streamId, streamRequests)
      }

      streamRequests.push(request)
    }

    const candidates = Array.from(requestsByStream).map(([streamId, requests]) => {
      return new Candidate(StreamID.fromString(streamId), requests)
    })
    // Make sure we process candidate streams in order of their earliest request.
    candidates.sort((candidate0, candidate1) => {
      return Math.sign(
        candidate0.earliestRequestDate.getTime() - candidate1.earliestRequestDate.getTime()
      )
    })
    return candidates
  }

  /**
   * Loads the streams corresponding to each Candidate and updates the internal bookkeeping within
   * each Candidate object to keep track of what the right CID to anchor for each Stream is. Also
   * returns information about the Requests that we already know at this point have failed, already
   * been anchored, or were excluded from processing in this batch.
   *
   * @param candidates
   * @param candidateLimit - limit on the number of candidate streams that can be returned.
   * @private
   */
  async _loadCandidateStreams(
    candidates: Candidate[],
    candidateLimit: number
  ): Promise<RequestGroups> {
    const failedRequests: Request[] = []
    const conflictingRequests: Request[] = []
    const unprocessedRequests: Request[] = []
    const alreadyAnchoredRequests: Request[] = []

    let numSelectedCandidates = 0
    if (candidateLimit == 0 || candidates.length < candidateLimit) {
      candidateLimit = candidates.length
    }

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]

      if (numSelectedCandidates >= candidateLimit) {
        // No need to process this candidate, we've already filled our anchor batch
        unprocessedRequests.push(...candidate.requests)
        continue
      }

      await AnchorService._loadCandidate(candidate, this.ceramicService)
      if (candidate.shouldAnchor()) {
        numSelectedCandidates++
        logger.debug(
          `Selected candidate stream #${numSelectedCandidates} of ${candidateLimit}: streamid ${candidate.streamId}`
        )
      } else if (candidate.alreadyAnchored) {
        logger.debug(`Stream ${candidate.streamId.toString()} is already anchored`)
        alreadyAnchoredRequests.push(...candidate.acceptedRequests)
      }
      failedRequests.push(...candidate.failedRequests)
      conflictingRequests.push(...candidate.rejectedRequests)
    }

    return {
      alreadyAnchoredRequests,
      acceptedRequests: [],
      conflictingRequests,
      failedRequests,
      unprocessedRequests,
    }
  }

  /**
   * Uses a multiQuery to load the current version of the Candidate Stream, while simultaneously
   * providing the Ceramic node the CommitIDs for each pending Request on this Stream. This ensures
   * that the Ceramic node we are using has at least heard of and considered every commit that
   * has a pending anchor request, even if it hadn't heard of that tip via pubsub. We can then
   * use the guaranteed current version of the Stream to decide what CID to anchor.
   * @param candidate
   * @param ceramicService
   * @private
   */
  static async _loadCandidate(candidate: Candidate, ceramicService: CeramicService): Promise<void> {
    // First, load the current known stream state from the ceramic node
    let stream
    try {
      stream = await ceramicService.loadStream(candidate.streamId)
    } catch (err) {
      logger.err(`Failed to load stream ${candidate.streamId.toString()}: ${err}`)
      candidate.failAllRequests()
      return
    }

    // Now filter out requests from the Candidate that are already present in the stream log
    const missingRequests = candidate.requests.filter((req) => {
      const found = stream.state.log.find(({ cid }) => {
        return cid.toString() == req.cid
      })
      return !found
    })

    // If stream already knows about all CIDs that we have requests for, great!
    if (missingRequests.length == 0) {
      candidate.setTipToAnchor(stream)
      return
    }

    for (const req of missingRequests) {
      console.debug(
        `Stream ${req.streamId} is missing Commit CID ${req.cid}. Sending multiquery to force ceramic to load it`
      )
    }

    // If there were CIDs that we have requests for but didn't show up in the stream state that
    // we loaded from Ceramic, we can't tell if that is because those commits were rejected by
    // Ceramic's conflict resolution, or if our local Ceramic node just never heard about those
    // commits before.  So we build a multiquery including all missing commits and send that to
    // Ceramic, forcing it to at least consider every CID that we have a request for.
    const queries = missingRequests.map((request) => {
      return { streamId: candidate.streamId.atCommit(request.cid).toString() }
    })
    queries.push({ streamId: candidate.streamId.baseID.toString() })

    // Send multiquery
    let response
    try {
      response = await ceramicService.multiQuery(queries)
    } catch (err) {
      logger.err(
        `Multiquery failed for stream ${candidate.streamId.toString()} with ${
          missingRequests.length
        } missing commits: ${err}`
      )
      candidate.failAllRequests()
      return
    }

    // Fail requests for tips that failed to be loaded
    for (const request of missingRequests) {
      const commitId = candidate.streamId.atCommit(request.cid)
      if (!response[commitId.toString()]) {
        logger.err(
          `Failed to load stream ${commitId.baseID.toString()} at commit ${commitId.commit.toString()}`
        )
        candidate.failRequest(request)
      }
    }
    if (candidate.allRequestsFailed()) {
      // If all pending requests for this stream failed to load then don't anchor the stream.
      logger.warn(
        `All pending request CIDs for stream ${candidate.streamId.toString()} failed to load - skipping stream`
      )
      return
    }

    // Get the current version of the Stream that has considered all pending request CIDs and select
    // tip to anchor
    stream = response[candidate.streamId.toString()]
    if (!stream) {
      logger.err(`Failed to load stream ${candidate.streamId.toString()}`)
      candidate.failAllRequests()
      return
    }
    candidate.setTipToAnchor(stream)
  }
}
