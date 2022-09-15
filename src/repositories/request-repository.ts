import { inject, singleton } from 'tsyringe'
import { ServiceMetrics as Metrics } from '../service-metrics.js'
import type { Knex } from 'knex'
import { CID } from 'multiformats/cid'
import { logEvent, logger } from '../logger/index.js'
import { METRIC_NAMES } from '../settings.js'
import { Utils } from '../utils.js'
import {
  TABLE_NAME,
  RequestStatus,
  Request,
  RequestUpdateFields,
  REQUEST_MESSAGES,
} from '../models/request.js'
interface Options {
  connection?: Knex
  limit?: number
}
// TODO STEPH: Move constants and add comments
const ANCHOR_DATA_RETENTION_WINDOW = 1000 * 60 * 60 * 24 * 30 // 30 days
const TRANSACTION_ISOLATION_LEVEL = 'repeatable read'
// application is recommended to automatically retry when seeing this error
const REPEATED_READ_SERIALIZATION_ERROR = '40001'
const TRANSACTION_MUTEX_ID = 4532
export const MAX_ANCHORING_DELAY_MS = 1000 * 60 * 60 * 12 //12H
export const PROCESSING_TIMEOUT = 1000 * 60 * 60 * 3 //3H
export const FAILURE_RETRY_WINDOW = 1000 * 60 * 60 * 48 // 48H

const findRequestsToAnchor = (connection: Knex, now: Date): Knex.QueryBuilder => {
  const earliestDateToRetryFailed = new Date(now.getTime() - FAILURE_RETRY_WINDOW)
  const processingDeadline = new Date(now.getTime() - PROCESSING_TIMEOUT)

  return connection(TABLE_NAME)
    .where((builder) =>
      builder
        .where({ status: RequestStatus.FAILED })
        .andWhere('createdAt', '>=', earliestDateToRetryFailed)
        .andWhere((subBuilder) =>
          subBuilder
            .whereNull('message')
            .orWhereNot({ message: REQUEST_MESSAGES.conflictResolutionRejection })
        )
    )
    .orWhere((builder) =>
      builder
        .where({ status: RequestStatus.PROCESSING })
        .andWhere('updatedAt', '<', processingDeadline)
    )
    .orWhere({ status: RequestStatus.PENDING })
}

const findStreamsToAnchor = (
  connection: Knex,
  maxStreamLimit: number,
  now: Date
): Knex.QueryBuilder => {
  const query = findRequestsToAnchor(connection, now)
    .select(['streamId', connection.raw('MIN(request.created_at) as min_created_at')])
    .orderBy('min_created_at', 'asc')
    .groupBy('streamId')

  if (maxStreamLimit !== 0) query.limit(maxStreamLimit)

  return query
}

const findRequestsToAnchorForStreams = (
  connection: Knex,
  streamIds: string[],
  now: Date
): Knex.QueryBuilder =>
  findRequestsToAnchor(connection, now)
    .andWhere('streamId', 'in', streamIds)
    .orderBy('createdAt', 'asc')

const countRetryMetrics = (requests: Request[], anchoringDeadline: Date): void => {
  const expired = requests.filter((request) => request.createdAt < anchoringDeadline)
  if (expired.length > 0) Metrics.count(METRIC_NAMES.RETRY_EXPIRING, expired.length)

  const processing = requests.filter((request) => request.status === RequestStatus.PROCESSING)
  if (processing.length > 0) Metrics.count(METRIC_NAMES.RETRY_PROCESSING, processing.length)

  const failed = requests.filter((request) => request.status === RequestStatus.FAILED)
  if (failed.length > 0) Metrics.count(METRIC_NAMES.RETRY_FAILED, failed.length)
}

@singleton()
export class RequestRepository {
  constructor(@inject('dbConnection') private connection?: Knex) {}

  /**
   * Create/updates client request
   * @param request - Request
   */
  public async createOrUpdate(request: Request, options: Options = {}): Promise<Request> {
    const { connection = this.connection } = options

    const [{ id }] = await connection
      .table(TABLE_NAME)
      .insert(request, ['id'])
      .onConflict('cid')
      .merge()

    return connection.table(TABLE_NAME).first().where({ id })
  }

  /**
   * Gets all requests that were anchored over a month ago, and that are on streams that have had
   * no other requests in the last month.
   */
  public async findRequestsToGarbageCollect(options: Options = {}): Promise<Request[]> {
    const { connection = this.connection } = options

    const now: number = new Date().getTime()
    const deadlineDate = new Date(now - ANCHOR_DATA_RETENTION_WINDOW)

    const recentlyUpdatedRequests = connection(TABLE_NAME)
      .orderBy('updatedAt', 'desc')
      .select('streamId')
      .where('updatedAt', '>=', deadlineDate)

    // expired requests with streams that have not been recently updated
    return await connection(TABLE_NAME)
      .orderBy('updatedAt', 'desc')
      .whereIn('status', [RequestStatus.COMPLETED, RequestStatus.FAILED])
      .andWhere('pinned', true)
      .andWhere('updatedAt', '<', deadlineDate)
      .whereNotIn('streamId', recentlyUpdatedRequests)
  }

  /**
   * Finds requests of a given status
   */
  public async findByStatus(status: RequestStatus, options: Options = {}): Promise<Request[]> {
    const { connection = this.connection, limit } = options

    const query = connection(TABLE_NAME).orderBy('updatedAt').where({ status })

    if (limit && limit !== 0) {
      query.limit(limit)
    }

    return query
  }

  /**
   * Create/updates client requests
   * @param fields - Fields to update
   * @param requests - Requests to update
   * @param manager - An optional EntityManager which if provided *must* be used for all database
   *   access. This is needed when creating anchors as part of a larger database transaction.
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
      .update({ ...fields, updatedAt: updatedAt })
      .whereIn('id', ids)

    requests.map((request) => {
      logEvent.db({
        type: 'request',
        ...request,
        ...fields,
        createdAt: request.createdAt.getTime(),
        updatedAt: updatedAt,
      })
    })

    return result
  }

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
          isolationLevel: TRANSACTION_ISOLATION_LEVEL,
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
   * Marks requests as READY. The following requests may be marked as ready in the order of precendence:
   *  1. There are FAILED requests that were not failed because of conflict resolution
   *  2. there are PROCESSING requests that need to be anchored and retried (the maximum anchoring delay has elapsed and the request hasn't been updated in a long time)
   *  3. there are PENDING requests that need to be anchored (the maximum anchoring delay has elapsed)
   * These requests are only marked as ready if there are streamLimit streams needing an anchor OR the earliest chosen request is about to expire
   *
   * Returns the original requests that were marked as READY
   */
  public async findAndMarkReady(
    maxStreamLimit: number,
    minStreamLimit = maxStreamLimit,
    options: Options = {}
  ): Promise<Request[]> {
    const { connection = this.connection } = options
    const now = new Date()
    const anchoringDeadline = new Date(now.getTime() - MAX_ANCHORING_DELAY_MS)

    return connection.transaction(
      async (trx) => {
        const streamsToAnchor = await findStreamsToAnchor(trx, maxStreamLimit, now)

        // Do not anchor if there are no streams to anchor
        if (streamsToAnchor.length === 0) {
          return []
        }

        // Anchor if we have enough streams or the earliest stream request is expired
        const enoughStreams = streamsToAnchor.length >= minStreamLimit
        const earliestIsExpired = streamsToAnchor[0].minCreatedAt < anchoringDeadline

        if (enoughStreams || earliestIsExpired) {
          const streamIds = streamsToAnchor.map(({ streamId }) => streamId)

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

          return requests
        }

        return []
      },
      {
        isolationLevel: TRANSACTION_ISOLATION_LEVEL,
      }
    )
  }

  /**
   * Creates new client request
   * @param cid: Client request CID
   */
  public async findByCid(cid: CID, options: Options = {}): Promise<Request> {
    const { connection = this.connection } = options

    return connection(TABLE_NAME).where({ cid: cid.toString() }).first()
  }

  /**
   * Acquires the transaction mutex before performing the operation.
   *
   * @param operation
   * @param maxAttempts Maximum amount of attempt to acquire the transaction mutex (defaults to Infinity)
   * @param delayMS The number of MS to wait between attempt (defaults to 5000 MS)
   * @returns
   */
  public async withTransactionMutex<T>(
    operation: () => Promise<T>,
    maxAttempts = Infinity,
    delayMS = 5000,
    options: Options = {}
  ): Promise<T> {
    const { connection = this.connection } = options

    return connection.transaction(
      async (trx) => {
        let attempt = 1
        while (attempt <= maxAttempts) {
          logger.debug(`Attempt ${attempt} at acquiring the transaction mutex before operation`)
          if (attempt > 5) Metrics.count(METRIC_NAMES.MANY_ATTEMPTS_TO_ACQUIRE_MUTEX, 1)

          const {
            rows: [{ pg_try_advisory_xact_lock: success }],
          } = await trx.raw(`SELECT pg_try_advisory_xact_lock(${TRANSACTION_MUTEX_ID})`)

          if (success) {
            return operation()
          }

          attempt++

          await Utils.delay(delayMS)
        }

        throw new Error(`Failed to acquire transaction mutex after ${maxAttempts} tries`)
      },
      {
        isolationLevel: TRANSACTION_ISOLATION_LEVEL,
      }
    )
  }

  /**
   * For test use only
   */
  public async createRequests(requests: Array<Request>, options: Options = {}): Promise<void> {
    const { connection = this.connection } = options

    return connection.table(TABLE_NAME).insert(requests)
  }
}
