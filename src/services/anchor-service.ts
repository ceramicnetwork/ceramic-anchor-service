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

const BATCH_SIZE = 128

type LoadCandidatesResult = {
  alreadyAnchoredRequests: Request[]
  conflictingRequests: Request[]
  failedRequests: Request[]
  unprocessedRequests: Request[]
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
    const requests: Request[] = await this.requestRepository.findNextToProcess()
    if (requests.length > nodeLimit) {
      logger.imp(
        'There are ' +
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
    const requests: Request[] = await this.requestRepository.findNextToProcess()
    await this._anchorRequests(requests)
  }

  private async _anchorRequests(requests: Request[]): Promise<void> {
    logger.imp('Anchoring pending requests...')

    if (requests.length === 0) {
      logger.debug('No pending CID requests found. Skipping anchor.')
      return
    }
    logger.debug('Marking pending requests as processing')
    await this.requestRepository.updateRequests(
      { status: RS.PROCESSING, message: 'Request is processing.' },
      requests
    )

    let streamCountLimit = 0 // 0 means no limit
    if (this.config.merkleDepthLimit > 0) {
      // The number of streams we are able to include in a single anchor batch is limited by the
      // max depth of the merkle tree.
      streamCountLimit = Math.pow(2, this.config.merkleDepthLimit)
    }
    const candidates: Candidate[] = await this._findCandidates(requests, streamCountLimit)
    if (candidates.length === 0) {
      logger.debug('No CID to request. Skipping anchor.')
      return
    }

    // filter valid requests
    const acceptedRequests = []
    for (const candidate of candidates) {
      logger.debug(
        `Anchoring CID ${candidate.cid.toString()} for stream ${candidate.streamId.toString()}`
      )
      acceptedRequests.push(...candidate.acceptedRequests)
    }

    logger.imp(`Creating Merkle tree from ${candidates.length} selected records`)
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
    await this._persistAnchorResult(anchors, acceptedRequests)

    logEvent.anchor({
      type: 'anchorRequests',
      requestIds: requests.map((r) => r.id),
      failedRequestsCount: requests.length - acceptedRequests.length,
      acceptedRequestsCount: acceptedRequests.length,
      candidateCount: candidates.length,
      anchorCount: anchors.length,
    })
    for (const candidate of merkleTree.getLeaves()) {
      logger.debug(
        `Successfully anchored CID ${candidate.cid.toString()} for stream ${candidate.streamId.toString()}`
      )
    }
    logger.imp(`Service successfully anchored ${anchors.length} CIDs.`)
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
    const anchors: Anchor[] = []
    const candidates = merkleTree.getLeaves()
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index]

      const anchor: Anchor = new Anchor()
      anchor.request = candidate.newestAcceptedRequest
      anchor.proofCid = ipfsProofCid.toString()

      const path = await merkleTree.getDirectPathFromRoot(index)
      anchor.path = path.map((p) => (p === PathDirection.L ? 0 : 1)).join('/')

      const ipfsAnchorRecord = { prev: candidate.cid, proof: ipfsProofCid, path: anchor.path }
      const anchorCid = await this.ipfsService.storeRecord(ipfsAnchorRecord)
      logger.debug(
        `Created anchor commit with CID ${anchorCid.toString()} for stream ${candidate.streamId.toString()}`
      )

      anchor.cid = anchorCid.toString()
      anchors.push(anchor)
    }
    return anchors
  }

  /**
   * Updates the anchor and request repositories in the local database with the results
   * of the anchor
   * @param anchors - Anchor objects to be persisted
   * @param requests - Requests to be marked as successful
   * @private
   */
  async _persistAnchorResult(anchors: Anchor[], requests: Request[]): Promise<void> {
    const queryRunner = this.connection.createQueryRunner()
    await queryRunner.startTransaction()
    try {
      await this.anchorRepository.createAnchors(anchors, queryRunner.manager)

      await this.requestRepository.updateRequests(
        {
          status: RS.COMPLETED,
          message: 'CID successfully anchored.',
        },
        requests,
        queryRunner.manager
      )

      await queryRunner.commitTransaction()
    } catch (err) {
      await queryRunner.rollbackTransaction()
      throw err
    } finally {
      await queryRunner.release()
    }
  }

  /**
   * Find candidates for the anchoring. Also updates the Request database for the Requests that we
   * already know at this point have failed, already been anchored, or were excluded from processing
   * in this batch.
   * @private
   */
  async _findCandidates(requests: Request[], candidateLimit: number): Promise<Candidate[]> {
    const candidates = AnchorService._buildCandidates(requests)

    logger.debug(`About to load candidate streams`)
    const {
      alreadyAnchoredRequests,
      conflictingRequests,
      failedRequests,
      unprocessedRequests,
    } = await this._loadCandidateStreams(candidates, candidateLimit)
    const candidatesToAnchor = candidates.filter((candidate) => {
      return candidate.shouldAnchor()
    })

    if (failedRequests.length > 0) {
      logger.debug(`About to fail requests for CIDs that could not be loaded`)
      await this.requestRepository.updateRequests(
        {
          status: RS.FAILED,
          message: 'Request has failed. Commit could not be loaded',
        },
        failedRequests
      )
    }

    if (conflictingRequests.length > 0) {
      logger.debug(`About to fail requests rejected by conflict resolution`)
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
      logger.debug(`Marking requests for CIDs that have already been anchored as COMPLETED`)
      await this.requestRepository.updateRequests(
        {
          status: RS.COMPLETED,
          message: 'Request was already anchored',
        },
        alreadyAnchoredRequests
      )
    }

    if (unprocessedRequests.length > 0) {
      logger.debug(`Returning unprocessed requests to PENDING status`)
      await this.requestRepository.updateRequests(
        {
          status: RS.PENDING,
          message: 'Request returned to pending.',
        },
        unprocessedRequests
      )
    }

    return candidatesToAnchor
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

    return Array.from(requestsByStream).map(([streamId, requests]) => {
      return new Candidate(StreamID.fromString(streamId), requests)
    })
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
  ): Promise<LoadCandidatesResult> {
    const failedRequests: Request[] = []
    const conflictingRequests: Request[] = []
    const unprocessedRequests: Request[] = []
    const alreadyAnchoredRequests: Request[] = []

    let index = 0
    let numSelectedCandidates = 0
    if (candidateLimit == 0) {
      // 0 means no limit
      candidateLimit = candidates.length
    }

    while (index < candidates.length && numSelectedCandidates < candidateLimit) {
      const batchSize = Math.min(BATCH_SIZE, candidateLimit - numSelectedCandidates)
      const batchCandidates = candidates.slice(
        index,
        Math.min(index + batchSize, candidates.length)
      )
      index += batchSize

      await Promise.all(
        batchCandidates.map(async (candidate) => {
          await AnchorService._loadCandidate(candidate, this.ceramicService)
          if (candidate.shouldAnchor()) {
            numSelectedCandidates++
          }
          failedRequests.push(...candidate.failedRequests)
          conflictingRequests.push(...candidate.rejectedRequests)
          if (candidate.alreadyAnchored) {
            alreadyAnchoredRequests.push(...candidate.acceptedRequests)
          }
        })
      )
    }

    return { alreadyAnchoredRequests, conflictingRequests, failedRequests, unprocessedRequests }
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
    // Build multiquery
    const queries = candidate.requests.map((request) => {
      return { streamId: candidate.streamId.atCommit(request.cid).toString() }
    })
    queries.push({ streamId: candidate.streamId.baseID.toString() })

    // Send multiquery
    let response
    try {
      response = await ceramicService.multiQuery(queries)
    } catch (err) {
      logger.err(`Failed to load stream ${candidate.streamId.toString()}: ${err}`)
      candidate.failAllRequests()
      return
    }

    // Fail requests for tips that failed to be loaded
    for (const request of candidate.requests) {
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

    // Get the current version of the Stream and select tip to anchor
    const stream = response[candidate.streamId.toString()]
    if (!stream) {
      logger.err(`Failed to load stream ${candidate.streamId.toString()}`)
      candidate.failAllRequests()
      return
    }
    candidate.setTipToAnchor(stream)
  }
}
