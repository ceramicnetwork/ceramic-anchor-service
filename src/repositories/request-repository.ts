import { CID } from 'multiformats/cid'
import type { Knex } from 'knex'
import { RequestStatus, Request, RequestUpdateFields, REQUEST_MESSAGES } from '../models/request.js'
import { LimitOptions, Options } from './repository-types.js'
import { logEvent } from '../logger/index.js'
import { Config } from 'node-config-ts'
import { inject, singleton } from 'tsyringe'
import { logger } from '../logger/index.js'
import { Utils } from '../utils.js'
import { ServiceMetrics as Metrics } from '../service-metrics.js'
import { METRIC_NAMES } from '../settings.js'

// How long we should keep recently anchored streams pinned on our local Ceramic node, to keep the
// AnchorCommit available to the network.
export const ANCHOR_DATA_RETENTION_WINDOW = 1000 * 60 * 60 * 24 * 30 // 30 days
// Amount of time a request can remain processing before being retried
export const PROCESSING_TIMEOUT = 1000 * 60 * 60 * 3 //3H
// If a request fails during this window, retry
export const FAILURE_RETRY_WINDOW = 1000 * 60 * 60 * 48 // 48H
// application is recommended to automatically retry when seeing this error
const REPEATED_READ_SERIALIZATION_ERROR = '40001'
export const TABLE_NAME = 'request'

const countRetryMetrics = (requests: Request[], anchoringDeadline: Date): void => {
  const expired = requests.filter((request) => request.createdAt < anchoringDeadline)
  if (expired.length > 0) Metrics.count(METRIC_NAMES.RETRY_EXPIRING, expired.length)

  const processing = requests.filter((request) => request.status === RequestStatus.PROCESSING)
  if (processing.length > 0) Metrics.count(METRIC_NAMES.RETRY_PROCESSING, processing.length)

  const failed = requests.filter((request) => request.status === RequestStatus.FAILED)
  if (failed.length > 0) Metrics.count(METRIC_NAMES.RETRY_FAILED, failed.length)
}

/**
 * Finds a batch of requests to anchor. A request will be included in the batch if:
 *  1. it is a PENDING request that need to be anchored
 *  2. it is ia PROCESSING requests that needs to be anchored and retried (the request hasn't been updated in a long time)
 *  3. it is a FAILED requests that failed for reasons other than conflict resolution and did not expire
 * @param connection
 * @param now
 * @returns
 */
const findRequestsToAnchor = (connection: Knex, now: Date): Knex.QueryBuilder => {
  const earliestDateToRetryFailed = new Date(now.getTime() - FAILURE_RETRY_WINDOW)
  const processingDeadline = new Date(now.getTime() - PROCESSING_TIMEOUT)

  return connection(TABLE_NAME).where((builder) => {
    builder
      .where({ status: RequestStatus.PENDING })
      .orWhere((subBuilder) =>
        subBuilder
          .where({ status: RequestStatus.PROCESSING })
          .andWhere('updatedAt', '<', processingDeadline)
      )
      .orWhere((subBuilder) =>
        subBuilder
          .where({ status: RequestStatus.FAILED })
          .andWhere('createdAt', '>=', earliestDateToRetryFailed)
          .andWhere((subSubBuilder) =>
            subSubBuilder
              .whereNull('message')
              .orWhereNot({ message: REQUEST_MESSAGES.conflictResolutionRejection })
          )
      )
  })
}

/**
 * Finds a batch of streams to anchor based on whether a stream's associated requests need to be anchored.
 * @param connection
 * @param maxStreamLimit max size of the batch
 * @param now
 * @returns Promise for the stream ids to anchor
 */
const findStreamsToAnchor = async (
  connection: Knex,
  maxStreamLimit: number,
  minStreamLimit: number,
  anchoringDeadline: Date,
  now: Date
): Promise<Array<string>> => {
  const query = findRequestsToAnchor(connection, now)
    .select(['streamId', connection.raw('MIN(request.created_at) as min_created_at')])
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
  const earliestIsExpired = streamsToAnchor[0].minCreatedAt < anchoringDeadline

  if (!enoughStreams && !earliestIsExpired) {
    logger.debug(
      `No streams are ready to anchor because there are not enough streams for a batch ${streamsToAnchor.length}/${minStreamLimit} and the earliest request is not expired (created at ${streamsToAnchor[0].minCreatedAt})`
    )

    return []
  }

  return streamsToAnchor.map(({ streamId }) => streamId)
}

/**
 * Finds a batch of requests to anchor that are are associated with the given streams
 * @param connection
 * @param streamIds streams to anchor
 * @param now
 * @returns
 */
const findRequestsToAnchorForStreams = (
  connection: Knex,
  streamIds: string[],
  now: Date
): Promise<Array<Request>> =>
  findRequestsToAnchor(connection, now).whereIn('streamId', streamIds).orderBy('createdAt', 'asc')

@singleton()
export class RequestRepository {
  constructor(
    @inject('config') private config?: Config,
    @inject('dbConnection') private connection?: Knex
  ) {}

  /**
   * Create/updates client request
   * @param request - Request
   * @param options
   * @returns A promise that resolves to the created request
   */
  public async createOrUpdate(request: Request, options: Options = {}): Promise<Request> {
    const { connection = this.connection } = options
    const [{ id }] = await connection
      .table(TABLE_NAME)
      .insert(request, ['id'])
      .onConflict('cid')
      .merge()

    const created = await connection.table(TABLE_NAME).first().where({ id })

    logEvent.db({
      type: 'request',
      action: 'upsert',
      ...request,
      createdAt: created.createdAt.getTime(),
      updatedAt: created.updatedAt.getTime(),
    })

    return created
  }

  /**
   * For test use. Creates an array of requests.
   * @param requests array of requests
   * @param options
   * @returns
   */
  public async createRequests(requests: Array<Request>, options: Options = {}): Promise<void> {
    const { connection = this.connection } = options

    await connection.table(TABLE_NAME).insert(requests)
  }

  /**
   * Create/updates client requests
   * @param fields - Fields to update
   * @param requests - Requests to update
   * @param options
   * @returns A promise that resolves to the number of updated requests
   */
  public async updateRequests(
    fields: RequestUpdateFields,
    requests: Request[],
    options: Options = {}
  ): Promise<number> {
    const { connection = this.connection } = options
    const updatedAt = new Date(Date.now())
    const ids = requests.map((r) => r.id)
    const result = await connection(TABLE_NAME)
      .update({
        message: fields.message,
        status: fields.status,
        pinned: fields.pinned,
        updatedAt: updatedAt,
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
   * @param options
   * @returns A promise for the array of READY requests that were updated
   */
  public async findAndMarkAsProcessing(options: Options = {}): Promise<Request[]> {
    const { connection = this.connection } = options

    return await connection
      .transaction(
        async (trx) => {
          const requests = await this.findByStatus(RequestStatus.READY, { connection: trx })
          if (requests.length === 0) {
            return []
          }

          const updatedCount = await this.updateRequests(
            { status: RequestStatus.PROCESSING },
            requests,
            {
              connection: trx,
            }
          )

          if (updatedCount != requests.length) {
            throw Error(
              `A problem occured when updated requests to PROCESSING. Only ${updatedCount}/${requests.length} requests were updated`
            )
          }

          return requests
        },
        {
          isolationLevel: 'serializable',
        }
      )
      .catch(async (err) => {
        if (err?.code === REPEATED_READ_SERIALIZATION_ERROR) {
          Metrics.count(METRIC_NAMES.DB_SERIALIZATION_ERROR, 1)
          await Utils.delay(100)
          return this.findAndMarkAsProcessing(options)
        }

        throw err
      })
  }

  /**
   * Finds a request with the given CID if exists
   * @param cid CID the request is for
   * @param options
   * @returns Promise for the associated request
   */
  public async findByCid(cid: CID, options: Options = {}): Promise<Request> {
    const { connection = this.connection } = options

    return connection(TABLE_NAME).where({ cid: cid.toString() }).first()
  }

  /**
   * Gets all requests that were anchored over a month ago, and that are on streams that have had
   * no other requests in the last month.
   * @param options
   * @returns A promise that resolves to an array of request
   */
  public async findRequestsToGarbageCollect(options: Options = {}): Promise<Request[]> {
    const { connection = this.connection } = options

    const now: number = new Date().getTime()
    const deadlineDate = new Date(now - ANCHOR_DATA_RETENTION_WINDOW)

    const requestsOnRecentlyUpdatedStreams = connection(TABLE_NAME)
      .orderBy('updatedAt', 'desc')
      .select('streamId')
      .where('updatedAt', '>=', deadlineDate)

    // expired requests with streams that have not been recently updated
    return await connection(TABLE_NAME)
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
   * @param options
   * @returns A promise that resolves to an array of the original requests that were marked as READY
   */
  public async findAndMarkReady(
    maxStreamLimit: number,
    minStreamLimit = maxStreamLimit,
    options: Options = {}
  ): Promise<Request[]> {
    const { connection = this.connection } = options
    const now = new Date()
    const anchoringDeadline = new Date(now.getTime() - this.config.maxAnchoringDelayMS)

    return connection
      .transaction(
        async (trx) => {
          const streamIds = await findStreamsToAnchor(
            trx,
            maxStreamLimit,
            minStreamLimit,
            anchoringDeadline,
            now
          )

          if (streamIds.length === 0) {
            logger.debug(`Not updating any requests to READY`)
            return []
          }

          const requests = await findRequestsToAnchorForStreams(trx, streamIds, now)

          const updatedCount = await this.updateRequests(
            { status: RequestStatus.READY },
            requests,
            {
              connection: trx,
            }
          )

          // if not all requests are updated
          if (updatedCount != requests.length) {
            throw Error(
              `A problem occured when updated requests to READY. Only ${updatedCount}/${requests.length} requests were updated`
            )
          }

          countRetryMetrics(requests, anchoringDeadline)

          logger.debug(`Updated ${updatedCount} requests to READY for ${streamIds.length} streams`)

          return requests
        },
        {
          isolationLevel: 'serializable',
        }
      )
      .catch(async (err) => {
        if (err?.code === REPEATED_READ_SERIALIZATION_ERROR) {
          Metrics.count(METRIC_NAMES.DB_SERIALIZATION_ERROR, 1)
          await Utils.delay(100)
          return this.findAndMarkReady(maxStreamLimit, minStreamLimit, options)
        }

        throw err
      })
  }

  /**
   * Finds requests of a given status
   * @param status
   * @param options
   * @returns A promise that resolves to an array of request with the given status
   */
  public async findByStatus(status: RequestStatus, options: LimitOptions = {}): Promise<Request[]> {
    const { connection = this.connection, limit } = options

    const query = connection(TABLE_NAME).orderBy('updatedAt', 'asc').where({ status })

    if (limit && limit !== 0) {
      query.limit(limit)
    }

    return query
  }

  /**
   * Returns the number of pending anchor requests that remain in the database.
   * @returns The number of requests in the database in status PENDING
   */
  public async countPendingRequests(): Promise<number> {
    const res = await this.connection(TABLE_NAME)
      .count('id')
      .where({ status: RequestStatus.PENDING })
      .first()
    return parseInt(res.count as string)
  }

  /**
   * Finds and updates all READY requests that are expired (have not been moved to PROCESSING in a sufficient amount of time)
   * Updating them indicates that they are being retried
   * @param options
   * @returns A promise for the number of expired ready requests updated
   */
  public async updateExpiringReadyRequests(options: Options = {}): Promise<number> {
    const { connection = this.connection } = options

    return await connection
      .transaction(
        async (trx) => {
          const readyRequests = await this.findByStatus(RequestStatus.READY, { connection: trx })
          const readyDeadline = Date.now() - this.config.readyRetryIntervalMS

          if (readyRequests.length === 0) {
            return 0
          }

          const earliestNotTimedOut = readyDeadline < readyRequests[0].updatedAt.getTime()
          if (earliestNotTimedOut) {
            return 0
          }

          // since the expiration of ready requests are determined by their "updated_at" field, update the requests again
          // to indicate that they are being retried
          const updatedCount = await this.updateRequests(
            { status: RequestStatus.READY },
            readyRequests,
            { connection: trx }
          )

          return updatedCount
        },
        {
          isolationLevel: 'serializable',
        }
      )
      .catch(async (err) => {
        if (err?.code === REPEATED_READ_SERIALIZATION_ERROR) {
          Metrics.count(METRIC_NAMES.DB_SERIALIZATION_ERROR, 1)
          await Utils.delay(100)
          return this.updateExpiringReadyRequests(options)
        }

        throw err
      })
  }
}
