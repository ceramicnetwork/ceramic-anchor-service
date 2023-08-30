import { CID } from 'multiformats/cid'
import type { Knex } from 'knex'
import { DATABASE_FIELDS, Request, RequestStatus, RequestUpdateFields } from '../models/request.js'
import { logEvent, logger } from '../logger/index.js'
import { Config } from 'node-config-ts'
import { Utils } from '../utils.js'
import {
  ServiceMetrics as Metrics,
  SinceField,
  TimeableMetric,
} from '@ceramicnetwork/observability'
import { METRIC_NAMES } from '../settings.js'
import { parseCountResult } from './parse-count-result.util.js'
import { StreamID } from '@ceramicnetwork/streamid'
import type { IMetadataRepository } from './metadata-repository.js'
import { date } from '@ceramicnetwork/codecs'

// How long we should keep recently anchored streams pinned on our local Ceramic node, to keep the
// AnchorCommit available to the network.
export const ANCHOR_DATA_RETENTION_WINDOW = 1000 * 60 * 60 * 24 * 30 // 30 days
// Amount of time a request can remain processing before being retried
export const PROCESSING_TIMEOUT = 1000 * 60 * 60 * 3 //3H
// If a request fails during this window, retry
export const FAILURE_RETRY_WINDOW = 1000 * 60 * 60 * 48 // 48H
// only retry failed requests if it hasn't been tried within the last 6 hours
export const FAILURE_RETRY_INTERVAL = 1000 * 60 * 60 * 6 // 6H
// application is recommended to automatically retry when seeing this error
const REPEATED_READ_SERIALIZATION_ERROR = '40001'

const TABLE_NAME = 'request'

/**
 * Records statistics about the set of requests
 * Groups by EXPIRED (if the time is past the deadline), PROCESSING, and FAILED
 *
 * Will record the total count, the mean time since createdAt, and the max time since createdAt
 * for each group
 *
 * @param requests
 * @param anchoringDeadline
 * @returns
 */
const recordAnchorRequestMetrics = (requests: Request[], anchoringDeadline: Date): void => {
  const created = new TimeableMetric(SinceField.CREATED_AT)
  const expired = new TimeableMetric(SinceField.CREATED_AT)
  const processing = new TimeableMetric(SinceField.UPDATED_AT)
  const failed = new TimeableMetric(SinceField.UPDATED_AT)

  for (const req of requests) {
    if (req.createdAt < anchoringDeadline) {
      expired.record(req)
    }

    if (req.status === RequestStatus.PROCESSING) {
      processing.record(req)
    } else if (req.status === RequestStatus.FAILED) {
      failed.record(req)
    } else if (req.status === RequestStatus.PENDING) {
      created.record(req)
    }
  }

  expired.publishStats(METRIC_NAMES.REQUEST_EXPIRED)
  created.publishStats(METRIC_NAMES.REQUEST_CREATED)

  processing.publishStats(METRIC_NAMES.RETRY_PROCESSING)
  failed.publishStats(METRIC_NAMES.RETRY_FAILED)
}

/**
 * Injection factory.
 */
function make(config: Config, connection: Knex, metadataRepository: IMetadataRepository) {
  return new RequestRepository(
    connection,
    config.maxAnchoringDelayMS,
    config.readyRetryIntervalMS,
    metadataRepository
  )
}
make.inject = ['config', 'dbConnection', 'metadataRepository'] as const

export class RequestRepository {
  static make = make

  constructor(
    private readonly connection: Knex,
    private readonly maxAnchoringDelayMS: number,
    private readonly readyRetryIntervalMS: number,
    private readonly metadataRepository: IMetadataRepository
  ) {}

  get table() {
    return this.connection(TABLE_NAME)
  }

  withConnection(connection: Knex): RequestRepository {
    return new RequestRepository(
      connection,
      this.maxAnchoringDelayMS,
      this.readyRetryIntervalMS,
      this.metadataRepository
    )
  }

  /**
   * Create/update client request
   * @returns A promise that resolves to the created request
   */
  async createOrUpdate(request: Request): Promise<Request> {
    const keys = Object.keys(request).filter((key) => key !== 'id') // all keys except ID
    const [{ id }] = await this.table.insert(request.toDB(), ['id']).onConflict('cid').merge(keys)

    const created = await this.table.where({ id }).first()

    logEvent.db({
      type: 'request',
      action: 'upsert',
      ...request,
      createdAt: created.createdAt.getTime(),
      updatedAt: created.updatedAt.getTime(),
    })

    return new Request(created)
  }

  async allRequests(): Promise<Array<Request>> {
    return this.table.orderBy('createdAt', 'asc')
  }

  /**
   * For test use. Creates an array of requests.
   * @param requests array of requests
   * @returns
   */
  async createRequests(requests: Array<Request>): Promise<void> {
    await this.table.insert(requests.map((request) => request.toDB()))
  }

  /**
   *
   * @param ids array of request ids to retreive
   * @returns A promise that resolves to the requests associated with the provided ids
   */
  async findByIds(givenIds: string[]): Promise<Request[]> {
    const uniqueIds = Array.from(new Set(givenIds))
    const requests = await this.table.whereIn('id', uniqueIds).orderBy('createdAt', 'asc')

    if (requests.length !== uniqueIds.length) {
      throw new Error(`Only found ${requests.length}/${uniqueIds.length} ids. Ids: ${uniqueIds}`)
    }

    return requests
  }

  /**
   * Create/updates client requests
   * @param fields - Fields to update
   * @param requests - Requests to update
   * @returns A promise that resolves to the number of updated requests
   */
  async updateRequests(fields: RequestUpdateFields, requests: Request[]): Promise<number> {
    const updatedAt = new Date()
    const ids = requests.map((r) => r.id)
    const result = await this.table
      .update({
        message: fields.message,
        status: fields.status,
        pinned: fields.pinned,
        updatedAt: date.encode(updatedAt),
      })
      .whereIn('id', ids)

    requests.map((request) => {
      logEvent.db({
        type: 'request',
        action: 'update',
        ...request,
        ...fields,
        createdAt: request.createdAt.getTime(),
        updatedAt: updatedAt,
      })
    })

    return result
  }

  /**
   * Finds all requests that are READY and sets them as PROCESSING
   * @returns A promise for the array of READY requests that were updated
   */
  async findAndMarkAsProcessing(): Promise<Request[]> {
    return await this.connection
      .transaction(
        async (trx) => {
          const embedded = this.withConnection(trx)
          const requests = await embedded.findByStatus(RequestStatus.READY)
          if (requests.length === 0) {
            return []
          }

          const updatedCount = await embedded.updateRequests(
            { status: RequestStatus.PROCESSING },
            requests
          )

          if (updatedCount != requests.length) {
            throw Error(
              `A problem occured when updated requests to PROCESSING. Only ${updatedCount}/${requests.length} requests were updated`
            )
          }

          // Record the requests we are processing, along with the time since they were marked as ready.
          const processing = new TimeableMetric(SinceField.UPDATED_AT)
          processing.recordAll(requests)
          processing.publishStats(METRIC_NAMES.READY_PROCESSING_MS)
          return requests
        },
        {
          isolationLevel: 'repeatable read',
        }
      )
      .catch(async (err) => {
        if (err?.code === REPEATED_READ_SERIALIZATION_ERROR) {
          Metrics.count(METRIC_NAMES.DB_SERIALIZATION_ERROR, 1)
          await Utils.delay(100)
          return this.findAndMarkAsProcessing()
        }

        throw err
      })
  }

  /**
   * Finds a request with the given CID if exists
   * @param cid CID the request is for
   * @returns Promise for the associated request
   */
  async findByCid(cid: CID | string): Promise<Request | undefined> {
    const found = await this.table.where({ cid: String(cid) }).first()
    if (found) {
      return new Request(found)
    }
    return undefined
  }

  /**
   * Gets all requests that were anchored over a month ago, and that are on streams that have had
   * no other requests in the last month.
   * @returns A promise that resolves to an array of request
   */
  async findRequestsToGarbageCollect(): Promise<Request[]> {
    const now: number = new Date().getTime()
    const deadlineDate = new Date(now - ANCHOR_DATA_RETENTION_WINDOW)

    const requestsOnRecentlyUpdatedStreams = this.table
      .orderBy('updatedAt', 'desc')
      .select('streamId')
      .where('updatedAt', '>=', deadlineDate)

    // expired requests with streams that have not been recently updated
    return this.table
      .orderBy('updatedAt', 'desc')
      .whereIn('status', [RequestStatus.COMPLETED, RequestStatus.FAILED])
      .andWhere('pinned', true)
      .andWhere('updatedAt', '<', deadlineDate)
      .whereNotIn('streamId', requestsOnRecentlyUpdatedStreams)
  }

  /**
   * Marks requests as READY.
   * The scheduler service uses this function to create a batch of READY requests.
   * These READY requests should get picked up by an anchor worker (launched by the scheduler service)
   * A READY batch will only be created if there are at least minStreamLimit streams included OR if requests are about to expire
   * A READY batch will include up to maxStreamLimit streams and their associated requests.
   *
   * @param maxStreamLimit the max amount of streams that can be in a batch
   * @param minStreamLimit (defaults to maxStreamLimit) the minimum amount of streams needed to create a READY batch
   * @returns A promise that resolves to an array of the original requests that were marked as READY
   */
  async findAndMarkReady(
    maxStreamLimit: number,
    minStreamLimit = maxStreamLimit
  ): Promise<Request[]> {
    const now = new Date()
    const anchoringDeadline = new Date(now.getTime() - this.maxAnchoringDelayMS)

    return this.connection
      .transaction(
        async (trx) => {
          const embedded = this.withConnection(trx)
          const streamIds = await embedded.findStreamsToAnchor(
            maxStreamLimit,
            minStreamLimit,
            anchoringDeadline,
            now
          )

          if (streamIds.length === 0) {
            logger.debug(`Not updating any requests to READY`)
            return []
          }

          const streamsWithMetadata = await embedded.hasMetadata(streamIds)

          const requests = await embedded.findRequestsToAnchorForStreams(streamsWithMetadata, now)

          if (requests.length === 0) {
            logger.debug(`No requests to mark as READY`)
            return []
          }

          const updatedCount = await embedded.updateRequests(
            { status: RequestStatus.READY },
            requests
          )

          // if not all requests are updated
          if (updatedCount != requests.length) {
            throw Error(
              `A problem occured when updated requests to READY. Only ${updatedCount}/${requests.length} requests were updated`
            )
          }

          // Record statistics about the anchor requests
          // Note they will be updated to READY in the database but the request status will still be PENDING
          recordAnchorRequestMetrics(requests, anchoringDeadline)

          logger.imp(`Updated ${updatedCount} requests to READY for ${streamIds.length} streams`)

          return requests
        },
        {
          isolationLevel: 'repeatable read',
        }
      )
      .catch(async (err) => {
        if (err?.code === REPEATED_READ_SERIALIZATION_ERROR) {
          Metrics.count(METRIC_NAMES.DB_SERIALIZATION_ERROR, 1)
          await Utils.delay(100)
          return this.findAndMarkReady(maxStreamLimit, minStreamLimit)
        }

        throw err
      })
  }

  /**
   * Finds requests of a given status
   * @param status
   * @returns A promise that resolves to an array of request with the given status
   */
  async findByStatus(status: RequestStatus): Promise<Request[]> {
    return this.table.orderBy('updatedAt', 'asc').where({ status })
  }

  /**
   * Return up to `limit` StreamIds for requests that has no corresponding metadata in the database.
   */
  async allWithoutMetadata(limit: number) {
    const result = await this.table
      .select('streamId')
      .whereNotExists(
        this.metadataRepository.table
          .select(this.connection.raw('NULL'))
          .where('streamId', '=', this.connection.raw('request.stream_id'))
      )
      .andWhere((sub) =>
        sub.whereIn('status', [
          RequestStatus.PENDING,
          RequestStatus.PROCESSING,
          RequestStatus.READY,
        ])
      )
      .orderBy('createdAt', 'ASC')
      .groupBy('streamId', 'createdAt')
      .limit(limit)
    return result.map((row) => StreamID.fromString(row.streamId))
  }

  async hasMetadata(streamIds: Array<StreamID | string> = []): Promise<Array<StreamID>> {
    const result = await this.table
      .select('streamId')
      .where((sub) => {
        sub.whereExists(
          this.metadataRepository.table
            .select(this.connection.raw('NULL'))
            .where('streamId', '=', this.connection.raw('request.stream_id'))
        )
      })
      .andWhere((sub) => {
        sub.whereIn('streamId', streamIds.map(String))
      })
    return result.map((row) => StreamID.fromString(row.streamId))
  }

  /**
   * Return number of requests by status.
   */
  async countByStatus(status: RequestStatus): Promise<number> {
    const result = await this.table
      .where({ status: status })
      .count<{ count: string | number }>('id')
      .first()
    return parseCountResult(result?.count)
  }

  /**
   * Finds and updates all READY requests that are expired (have not been moved to PROCESSING in a sufficient amount of time)
   * Updating them indicates that they are being retried
   * @returns A promise for the number of expired ready requests updated
   */
  async updateExpiringReadyRequests(): Promise<number> {
    return await this.connection
      .transaction(
        async (trx) => {
          const embedded = this.withConnection(trx)
          const readyRequests = await embedded.findByStatus(RequestStatus.READY)
          const readyDeadline = Date.now() - this.readyRetryIntervalMS

          if (readyRequests.length === 0) {
            return 0
          }

          const earliestNotTimedOut =
            readyRequests[0] && readyDeadline < readyRequests[0].updatedAt.getTime()
          if (earliestNotTimedOut) {
            return 0
          }

          // since the expiration of ready requests are determined by their "updated_at" field, update the requests again
          // to indicate that they are being retried
          const updatedCount = await embedded.updateRequests(
            { status: RequestStatus.READY },
            readyRequests
          )

          return updatedCount
        },
        {
          isolationLevel: 'repeatable read',
        }
      )
      .catch(async (err) => {
        if (err?.code === REPEATED_READ_SERIALIZATION_ERROR) {
          Metrics.count(METRIC_NAMES.DB_SERIALIZATION_ERROR, 1)
          await Utils.delay(100)
          return this.updateExpiringReadyRequests()
        }

        throw err
      })
  }

  /**
   * Mark PENDING requests older than `request.timestamp` REPLACED if they share same `request.origin` and `request.streamId`s.
   */
  markPreviousReplaced(request: Pick<Request, 'origin' | 'streamId' | 'cid'>): Promise<number> {
    return this.table
      .whereIn('id', function () {
        return this.select('id')
          .from(TABLE_NAME)
          .where({
            origin: request.origin,
            streamId: request.streamId,
            status: RequestStatus.PENDING,
          })
          .orderBy('timestamp', 'DESC')
          .offset(1)
      })
      .update({ status: RequestStatus.REPLACED, message: `Replaced by ${request.cid}` })
  }

  /**
   * Finds a batch of requests to anchor. A request will be included in the batch if:
   *  1. it is a PENDING request that need to be anchored
   *  2. it is ia PROCESSING requests that needs to be anchored and retried (the request hasn't been updated in a long time)
   *  3. it is a FAILED requests that failed for reasons other than conflict resolution and did not expire
   * @param now
   * @returns
   */
  findRequestsToAnchor(now: Date): Knex.QueryBuilder {
    // const earliestFailedCreatedAtToRetry = new Date(now.getTime() - FAILURE_RETRY_WINDOW)
    const processingDeadline = new Date(now.getTime() - PROCESSING_TIMEOUT)
    // const latestFailedUpdatedAtToRetry = new Date(now.getTime() - FAILURE_RETRY_INTERVAL)

    return this.table.where((builder) => {
      builder
        .where({ status: RequestStatus.PENDING })
        .orWhere((subBuilder) =>
          subBuilder
            .where({ status: RequestStatus.PROCESSING })
            .andWhere('updatedAt', '<', date.encode(processingDeadline))
        )
      // TODO: https://linear.app/3boxlabs/issue/CDB-2221/turn-cas-failure-retry-back-on
      // .orWhere((subBuilder) =>
      //   subBuilder
      //     .where({ status: RequestStatus.FAILED })
      //     .andWhere('createdAt', '>=', te.date.encode(earliestFailedCreatedAtToRetry))
      //     .andWhere('updatedAt', '<=', te.date.encode(latestFailedUpdatedAtToRetry))
      //     .andWhere((subSubBuilder) =>
      //       subSubBuilder
      //         .whereNull('message')
      //         .orWhereNot({ message: REQUEST_MESSAGES.conflictResolutionRejection })
      //     )
      // )
    })
  }

  /**
   * Finds a batch of streams to anchor based on whether a stream's associated requests need to be anchored.
   * @param maxStreamLimit max size of the batch
   * @param minStreamLimit
   * @param anchoringDeadline
   * @param now
   * @returns Promise for the stream ids to anchor
   */
  async findStreamsToAnchor(
    maxStreamLimit: number,
    minStreamLimit: number,
    anchoringDeadline: Date,
    now: Date
  ): Promise<Array<string>> {
    const query = this.findRequestsToAnchor(now)
      .select<[{ streamId: string; minCreatedAt: Date }]>([
        'streamId',
        this.connection.raw('MIN(request.created_at) as min_created_at'),
      ])
      .orderBy('min_created_at', 'asc')
      .groupBy('streamId')

    if (maxStreamLimit !== 0) query.limit(maxStreamLimit)

    const streamsToAnchor = await query

    // Do not anchor if there are no streams to anchor
    if (streamsToAnchor.length === 0) {
      logger.debug(`No streams were found that are ready to anchor`)
      return []
    }

    // Return a batch of streams only if we have enough streams to fill a batch or the earliest stream request is expired
    const enoughStreams = streamsToAnchor.length >= minStreamLimit
    const firstStreamToAnchor = streamsToAnchor[0]
    const earliestIsExpired =
      firstStreamToAnchor && firstStreamToAnchor.minCreatedAt < anchoringDeadline

    if (!enoughStreams && !earliestIsExpired) {
      logger.debug(
        `No streams are ready to anchor because there are not enough streams for a batch ${streamsToAnchor.length}/${minStreamLimit} and the earliest request is not expired (created at ${firstStreamToAnchor?.minCreatedAt})`
      )

      return []
    }

    return streamsToAnchor.map(({ streamId }) => streamId)
  }

  /**
   * Finds a batch of requests to anchor that are are associated with the given streams
   * @param streamIds streams to anchor
   * @param now
   * @returns
   */
  findRequestsToAnchorForStreams(
    streamIds: Array<StreamID | string>,
    now: Date
  ): Promise<Array<Request>> {
    return this.findRequestsToAnchor(now)
      .whereIn('streamId', streamIds.map(String))
      .orderBy('createdAt', 'asc')
  }

  /**
   * Mark requests in READY state as PROCESSING and return them.
   * @param minStreamLimit - If found less than `minStreamLimit` requests, do nothing.
   * @param maxStreamLimit - Get up to `maxStreamLimit` entries. `0` means there is no upper limit.
   * @return Requests with PROCESSING status.
   */
  // TODO CDB-2231 Reconsider if minStreamLimit should be here or not
  // async batchProcessing(minStreamLimit: number, maxStreamLimit: number): Promise<Array<Request>> {
  async batchProcessing(maxStreamLimit: number): Promise<Array<Request>> {
    let whereInSubQuery = this.table.select('id').where({ status: RequestStatus.READY })
    if (maxStreamLimit > 0) whereInSubQuery = whereInSubQuery.limit(maxStreamLimit)

    const returned = await this.table
      .update({ status: RequestStatus.PROCESSING })
      .whereIn(
        // current status == PENDING and we get `maxStreamLimit` at most
        'id',
        whereInSubQuery
      )
      // TODO CDB-2231 Reconsider if it should be here or not
      // .andWhere(
      //   // if number of PENDING rows is less then `minStreamLimit`, do not update
      //   minStreamLimit,
      //   '<=',
      //   this.table.count('id').where({ status: RequestStatus.READY })
      // )
      .returning(DATABASE_FIELDS)
    return returned.map((r) => new Request(r))
  }
}
