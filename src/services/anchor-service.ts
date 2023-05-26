import { CID } from 'multiformats/cid'

import type { Config } from 'node-config-ts'

import { logEvent, logger } from '../logger/index.js'
import { Utils } from '../utils.js'
import { Anchor } from '../models/anchor.js'
import { Request, RequestStatus, RequestStatus as RS } from '../models/request.js'
import type { Transaction } from '../models/transaction.js'
import type { RequestRepository } from '../repositories/request-repository.js'
import type { TransactionRepository } from '../repositories/transaction-repository.js'
import type { EventProducerService } from './event-producer/event-producer-service.js'
import {
  ServiceMetrics as Metrics,
  SinceField,
  TimeableMetric,
} from '@ceramicnetwork/observability'
import { METRIC_NAMES } from '../settings.js'
import type { BlockchainService } from './blockchain/blockchain-service.js'
import { StreamID } from '@ceramicnetwork/streamid'

import { v4 as uuidv4 } from 'uuid'
import type { Knex } from 'knex'
import type { IIpfsService } from './ipfs-service.type.js'
import type { IAnchorRepository } from '../repositories/anchor-repository.type.js'
import type { IMetadataService } from './metadata-service.js'
import { pathString, type CIDHolder, type TreeMetadata } from '@ceramicnetwork/anchor-utils'
import { Candidate } from './candidate.js'
import { MerkleCarFactory, type IMerkleTree, type MerkleCAR } from '../merkle/merkle-car-factory.js'
import { IQueueService } from './queue/queue-service.type.js'
import { AnchorBatch } from '../models/queue-message.js'

const CONTRACT_TX_TYPE = 'f(bytes32)'

type RequestGroups = {
  alreadyAnchoredRequests: Request[]
  failedRequests: Request[]
  unprocessedRequests: Request[]
  acceptedRequests: Request[]
}

type AnchorSummary = {
  // all requests included in this batch
  acceptedRequestsCount: number
  // number of accepted requests that were anchored in a previous batch and were not included in the current batch.
  alreadyAnchoredRequestsCount: number
  // requests that were successfully anchored in this batch
  anchoredRequestsCount: number
  // requests whose CIDs were rejected by Ceramic's conflict resolution.
  conflictingRequestCount: number
  // failed requests (possible reasons: loading, publishing anchor commits)
  failedRequestsCount: number
  // streams included in the merkle tree, but whose anchor commits were not published
  failedToPublishAnchorCommitCount: number
  // requests not included in this batch because the batch was already full
  unprocessedRequestCount: number
  // streams considered in this batch
  candidateCount: number
  // anchors created in this batch
  anchorCount: number
  // anchors that were created in this batch but were already created in a previous batch and therefore not persisted in our DB
  reanchoredCount: number
  // requests that can be retried in a later batch
  canRetryCount: number
}

const logAnchorSummary = async (
  requestRepository: RequestRepository,
  groupedRequests: RequestGroups,
  candidates: Candidate[],
  results: Partial<AnchorSummary> = {}
) => {
  const pendingRequestsCount = await requestRepository.countByStatus(RequestStatus.PENDING)

  const anchorSummary: AnchorSummary = Object.assign(
    {
      acceptedRequestsCount: groupedRequests.acceptedRequests.length,
      alreadyAnchoredRequestsCount: groupedRequests.alreadyAnchoredRequests.length,
      anchoredRequestsCount: 0,
      conflictingRequestCount: 0,
      failedRequestsCount: groupedRequests.failedRequests.length,
      failedToPublishAnchorCommitCount: 0,
      unprocessedRequestCount: groupedRequests.unprocessedRequests.length,
      pendingRequestsCount,
      candidateCount: candidates.length,
      anchorCount: 0,
      canRetryCount: groupedRequests.failedRequests.length,
      reanchoredCount: 0,
    },
    results
  )

  Metrics.recordObjectFields('anchorBatch', anchorSummary)
  Metrics.recordRatio(
    'anchorBatch_failureRatio',
    anchorSummary.failedRequestsCount,
    anchorSummary.anchoredRequestsCount
  )

  logEvent.anchor({
    type: 'anchorRequests',
    ...anchorSummary,
  })
}
/**
 * Anchors CIDs to blockchain
 */
export class AnchorService {
  private readonly merkleDepthLimit: number
  private readonly includeBlockInfoInAnchorProof: boolean
  private readonly useSmartContractAnchors: boolean
  private readonly useQueueBatches: boolean
  private readonly maxStreamLimit: number
  private readonly minStreamLimit: number
  private readonly merkleCarFactory: MerkleCarFactory

  static inject = [
    'blockchainService',
    'config',
    'ipfsService',
    'requestRepository',
    'transactionRepository',
    'anchorRepository',
    'dbConnection',
    'eventProducerService',
    'metadataService',
    'anchorBatchQueueService',
  ] as const

  constructor(
    private readonly blockchainService: BlockchainService,
    config: Config,
    private readonly ipfsService: IIpfsService,
    private readonly requestRepository: RequestRepository,
    private readonly transactionRepository: TransactionRepository,
    private readonly anchorRepository: IAnchorRepository,
    private readonly connection: Knex,
    private readonly eventProducerService: EventProducerService,
    private readonly metadataService: IMetadataService,
    private readonly anchorBatchQueueService: IQueueService<AnchorBatch>
  ) {
    this.merkleDepthLimit = config.merkleDepthLimit
    this.includeBlockInfoInAnchorProof = config.includeBlockInfoInAnchorProof
    this.useSmartContractAnchors = config.useSmartContractAnchors
    this.useQueueBatches = config.useQueueBatches

    const minStreamCount = Number(config.minStreamCount)
    this.maxStreamLimit = this.merkleDepthLimit > 0 ? Math.pow(2, this.merkleDepthLimit) : 0
    this.minStreamLimit = minStreamCount || Math.floor(this.maxStreamLimit / 2)
    this.merkleCarFactory = new MerkleCarFactory(logger, this.merkleDepthLimit)
  }

  /**
   * Creates anchors for pending client requests
   */
  // TODO: Remove for CAS V2 as we won't need to move PENDING requests to ready. Switch to using anchorReadyRequests.
  async anchorRequests(): Promise<void> {
    // TODO FIXME Remove after backfill
    // const withoutMetadata = await this.requestRepository.allWithoutMetadata(
    //   this.minStreamLimit || this.maxStreamLimit || 100
    // )
    // await this.metadataService.fillAll(withoutMetadata)
    if (this.useQueueBatches) {
      return this.anchorNextQueuedBatch()
    } else {
      const readyRequestsCount = await this.requestRepository.countByStatus(RS.READY)

      if (readyRequestsCount === 0) {
        // Pull in twice as many streams as we want to anchor, since some of those streams may fail to load.
        await this.requestRepository.findAndMarkReady(this.maxStreamLimit * 2, this.minStreamLimit)
      }

      return this.anchorReadyRequests()
    }
  }

  /**
   * Creates anchors for client requests that have been marked as READY
   */
  async anchorNextQueuedBatch(): Promise<void> {
    if (!this.useQueueBatches) {
      throw new Error(
        'Cannot anchor next queued batch as the worker is not configured to do so. Please set `useQueueBatches` in the config if this is desired.'
      )
    }

    logger.imp('Retrieving next job from queue')
    const batchMessage = await this.anchorBatchQueueService.retrieveNextMessage()

    if (!batchMessage) {
      // TODO: Add metric here
      logger.imp('No batches available')
      return
    }

    try {
      logger.imp('Anchoring requests from the batch')
      const requests = await this.requestRepository.findByIds(batchMessage.data.rids)

      logger.imp('Anchoring requests')
      await this._anchorRequests(requests)

      // Sleep 5 seconds before exiting the process to give time for the logs to flush.
      await Utils.delay(5000)

      logger.imp('Acking the batch')
      await batchMessage.ack()
    } catch (err) {
      logger.warn(`Anchoring of the batch failed. Nacking the batch`)
      await batchMessage.nack()

      throw err
    }
  }

  /**
   * Creates anchors for client requests that have been marked as READY
   */
  async anchorReadyRequests(): Promise<void> {
    logger.imp('Anchoring ready requests...')
    const requests = await this.requestRepository.batchProcessing(this.maxStreamLimit)
    await this._anchorRequests(requests)

    // Sleep 5 seconds before exiting the process to give time for the logs to flush.
    await Utils.delay(5000)
  }

  private async _anchorRequests(requests: Request[]): Promise<void> {
    if (requests.length === 0) {
      logger.imp('No pending CID requests found. Skipping anchor.')
      return
    }

    const [candidates, groupedRequests] = await this._findCandidates(requests, this.maxStreamLimit)

    if (candidates.length === 0) {
      logger.imp('No candidates found. Skipping anchor.')
      await logAnchorSummary(this.requestRepository, groupedRequests, candidates)
      return
    }

    try {
      const results = await this._anchorCandidates(candidates)
      await logAnchorSummary(this.requestRepository, groupedRequests, candidates, results)
      return
    } catch (err) {
      logger.warn(
        `Updating PROCESSING requests to PENDING so they are retried in the next batch because an error occurred while creating the anchors: ${err}`
      )
      const acceptedRequests = candidates.map((candidate) => candidate.request).flat()
      await this.requestRepository.updateRequests({ status: RS.PENDING }, acceptedRequests)

      Metrics.count(METRIC_NAMES.REVERT_TO_PENDING, acceptedRequests.length)

      // groupRequests.failedRequests does not include all the newly failed requests so we recount here
      const failedRequests = []
      await logAnchorSummary(this.requestRepository, groupedRequests, candidates, {
        failedRequestsCount: failedRequests.length,
        // NOTE: We will retry all of the above requests that were updated back to PENDING.
        // We also may retry all failed requests other than requests rejected from conflict resolution.
        // A failed request will not be retried if it has expired when the next anchor runs.
        canRetryCount: failedRequests.length + acceptedRequests.length,
      })

      throw err
    }
  }

  private async _anchorCandidates(candidates: Candidate[]): Promise<Partial<AnchorSummary>> {
    logger.imp(`Creating Merkle tree from ${candidates.length} selected streams`)
    const span = Metrics.startSpan('anchor_candidates')
    const merkleTree = await this._buildMerkleTree(candidates)

    // FIXME Import
    for (const block of merkleTree.car.blocks) {
      const payload = merkleTree.car.get(block.cid)
      await this.ipfsService.storeRecord(payload)
    }

    // create and send ETH transaction
    const tx: Transaction = await this.transactionRepository.withTransactionMutex(() => {
      logger.debug('Preparing to send transaction to put merkle root on blockchain')
      return this.blockchainService.sendTransaction(merkleTree.root.data.cid)
    })

    // create proof on IPFS
    logger.debug('Creating IPFS anchor proof')
    const ipfsProofCid = await this._createIPFSProof(tx, merkleTree.root.data.cid)

    // create anchor records on IPFS
    logger.debug('Creating anchor commits')
    const anchors = await this._createAnchorCommits(ipfsProofCid, merkleTree)

    // Update the database to record the successful anchors
    logger.debug('Persisting results to local database')
    const persistedAnchorsCount = await this._persistAnchorResult(anchors, candidates)

    const anchoredRequests = []
    for (const candidate of candidates) {
      anchoredRequests.push(candidate.request)
    }

    logger.imp(`Service successfully anchored ${anchors.length} CIDs.`)
    Metrics.count(METRIC_NAMES.ANCHOR_SUCCESS, anchors.length)

    const reAnchoredCount = anchors.length - persistedAnchorsCount
    logger.debug(
      `Did not persist ${reAnchoredCount} anchor commits as they have been already created for these requests`
    )
    Metrics.count(METRIC_NAMES.REANCHORED, reAnchoredCount)

    span.end()

    return {
      anchoredRequestsCount: anchoredRequests.length,
      failedToPublishAnchorCommitCount: merkleTree.leafNodes.length - anchors.length,
      anchorCount: anchors.length,
      reanchoredCount: reAnchoredCount,
    }
  }

  /**
   * Emits an anchor event if
   * 1. There are existing ready requests that have timed out (have not been picked up and set to
   * PROCESSING by an anchor worker in a reasonable amount of time)
   * 2. There are requests that have been successfully marked as READY
   * An anchor event indicates that a batch of requests are ready to be anchored. An anchor worker will retrieve these READY requests,
   * mark them as PROCESSING, and perform an anchor.
   */
  async emitAnchorEventIfReady(): Promise<void> {
    const readyRequestsCount = await this.requestRepository.countByStatus(RS.READY)

    if (readyRequestsCount > 0) {
      // if ready requests have been updated because they have expired
      // we will retry them by emitting an anchor event and not marking anymore requests as READY
      const updatedExpiredReadyRequestsCount =
        await this.requestRepository.updateExpiringReadyRequests()

      if (updatedExpiredReadyRequestsCount === 0) {
        return
      }

      logger.imp(
        `Emitting an anchor event because ${updatedExpiredReadyRequestsCount} READY requests expired`
      )
      Metrics.count(METRIC_NAMES.RETRY_EMIT_ANCHOR_EVENT, updatedExpiredReadyRequestsCount)
    } else {
      const updatedRequests = await this.requestRepository.findAndMarkReady(
        this.maxStreamLimit,
        this.minStreamLimit
      )

      if (updatedRequests.length === 0) {
        return
      }

      logger.imp(`Emitting an anchor event with ${updatedRequests.length} new READY requests`)
    }

    await this.eventProducerService.emitAnchorEvent(uuidv4().toString()).catch((err) => {
      // We do not crash when we cannot emit an anchor event
      // An event will emit the next time this is run and the ready requests have expired (in READY_TIMEOUT)
      logger.err(`Error when emitting an anchor event: ${err}`)
    })
  }

  /**
   * Builds merkle tree
   * @param candidates
   * @private
   */
  async _buildMerkleTree(candidates: Candidate[]): Promise<MerkleCAR> {
    try {
      return await this.merkleCarFactory.build(candidates)
    } catch (e: any) {
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
    const txHashCid = Utils.convertEthHashToCid(tx.txHash.slice(2))
    let ipfsAnchorProof = {
      root: merkleRootCid,
      chainId: tx.chain,
      txHash: txHashCid,
    } as any

    if (this.includeBlockInfoInAnchorProof) {
      ipfsAnchorProof = {
        blockNumber: tx.blockNumber,
        blockTimestamp: tx.blockTimestamp,
        ...ipfsAnchorProof,
      }
    }

    if (this.useSmartContractAnchors) ipfsAnchorProof.txType = CONTRACT_TX_TYPE

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
    merkleTree: IMerkleTree<CIDHolder, Candidate, TreeMetadata>
  ): Promise<Anchor[]> {
    const leafNodes = merkleTree.leafNodes
    const anchors = []

    for (const [index, leafNode] of leafNodes.entries()) {
      const candidate = leafNode.data
      logger.debug(
        `Creating anchor commit #${index + 1} of ${
          leafNodes.length
        }: stream id ${candidate.streamId.toString()} at commit CID ${candidate.cid}`
      )
      const anchor = await this._createAnchorCommit(candidate, index, ipfsProofCid, merkleTree)
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
    merkleTree: IMerkleTree<CIDHolder, Candidate, TreeMetadata>
  ): Promise<Anchor | null> {
    const anchor: Anchor = new Anchor()
    anchor.requestId = candidate.request.id
    anchor.proofCid = ipfsProofCid.toString()

    const path = merkleTree.getDirectPathFromRoot(candidateIndex)
    anchor.path = pathString(path)

    const ipfsAnchorCommit = {
      id: candidate.streamId.cid,
      prev: candidate.cid,
      proof: ipfsProofCid,
      path: anchor.path,
    }

    try {
      const anchorCid = await this.ipfsService.publishAnchorCommit(
        ipfsAnchorCommit,
        candidate.streamId
      )
      anchor.cid = anchorCid.toString()

      logger.debug(
        `Created anchor commit with CID ${anchorCid.toString()} for stream ${candidate.streamId.toString()}`
      )
    } catch (err) {
      const msg = `Error publishing anchor commit of commit ${
        candidate.cid
      } for stream ${candidate.streamId.toString()}: ${err}`
      logger.err(msg)
      Metrics.count(METRIC_NAMES.ERROR_IPFS, 1)
      await this.requestRepository.updateRequests({ status: RS.FAILED, message: msg }, [
        candidate.request,
      ])
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
   * @returns The number of anchors persisted
   * @private
   */
  async _persistAnchorResult(anchors: Anchor[], candidates: Candidate[]): Promise<number> {
    // filter to requests for streams that were actually anchored successfully
    const acceptedRequests = []
    for (const candidate of candidates) {
      acceptedRequests.push(candidate.request)
    }

    const trx = await this.connection.transaction(null, { isolationLevel: 'repeatable read' })
    try {
      const persistedAnchorsCount =
        anchors.length > 0
          ? await this.anchorRepository.withConnection(trx).createAnchors(anchors)
          : 0

      await this.requestRepository.withConnection(trx).updateRequests(
        {
          status: RS.COMPLETED,
          message: 'CID successfully anchored.',
          pinned: true,
        },
        acceptedRequests
      )

      await trx.commit()

      // record some metrics about the timing and count of anchors
      const completed = new TimeableMetric(SinceField.CREATED_AT)
      completed.recordAll(acceptedRequests)
      completed.publishStats(METRIC_NAMES.CREATED_SUCCESS_MS)
      Metrics.count(METRIC_NAMES.ACCEPTED_REQUESTS, acceptedRequests.length)

      return persistedAnchorsCount
    } catch (err) {
      await trx.rollback()
      throw err
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
    candidateLimit: number
  ): Promise<[Candidate[], RequestGroups]> {
    logger.debug(`Grouping requests by stream`)
    const candidates = await this._buildCandidates(requests)

    logger.debug(`Loading candidate streams`)
    // FIXME PREV
    const groupedRequests = await this._loadCandidateStreams(candidates, candidateLimit)

    for (const candidate of candidates) {
      groupedRequests.acceptedRequests.push(candidate.request)
    }

    return [candidates, groupedRequests]
  }

  /**
   * Groups requests on the same StreamID into single Candidate objects.
   * @param requests
   */
  async _buildCandidates(requests: Request[]): Promise<Array<Candidate>> {
    const candidates = []
    for (const request of requests) {
      const streamId = StreamID.fromString(request.streamId)
      const metadata = await this.metadataService.retrieve(streamId)
      if (metadata) {
        const candidate = new Candidate(streamId, request, metadata.metadata)
        candidates.push(candidate)
      }
    }
    // Make sure we process candidate streams in order of their earliest request.
    candidates.sort(Candidate.sortByTimestamp)
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
    const unprocessedRequests: Request[] = []
    const alreadyAnchoredRequests: Request[] = []

    let numSelectedCandidates = 0
    if (candidateLimit == 0 || candidates.length < candidateLimit) {
      candidateLimit = candidates.length
    }

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i] as Candidate

      if (numSelectedCandidates >= candidateLimit) {
        // No need to process this candidate, we've already filled our anchor batch
        unprocessedRequests.push(candidate.request)
        continue
      }

      // anchor commit may already exist so check first
      const existingAnchorCommit = candidate.shouldAnchor()
        ? await this.anchorRepository.findByRequest(candidate.request)
        : null

      if (existingAnchorCommit) {
        candidate.markAsAnchored()
      }

      if (candidate.shouldAnchor()) {
        numSelectedCandidates++
        logger.debug(
          `Selected candidate stream #${numSelectedCandidates} of ${candidateLimit}: streamid ${candidate.streamId} at commit cid ${candidate.cid}`
        )
      } else if (candidate.alreadyAnchored) {
        logger.debug(`Stream ${candidate.streamId.toString()} is already anchored`)
        alreadyAnchoredRequests.push(candidate.request)
      }
    }

    return {
      alreadyAnchoredRequests,
      acceptedRequests: [],
      failedRequests: [],
      unprocessedRequests,
    }
  }
}
