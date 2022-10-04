import { inject, singleton } from 'tsyringe'
import { ServiceMetrics as Metrics } from '../service-metrics/index.js'
import type { Knex } from 'knex'
import { CID } from 'multiformats/cid'
import { logEvent } from '../logger/index.js'
import { METRIC_NAMES } from '../settings.js'
import { Utils } from '../utils.js'
import {
  TABLE_NAME,
  ANCHOR_DATA_RETENTION_WINDOW,
  MAX_ANCHORING_DELAY_MS,
  PROCESSING_TIMEOUT,
  FAILURE_RETRY_WINDOW,
  RequestStatus,
  Request,
  RequestUpdateFields,
  REQUEST_MESSAGES,
} from '../models/request.js'
import { LimitOptions, Options } from './repository-types.js'
import { logger } from '../logger/index.js'

// application is recommended to automatically retry when seeing this error
const REPEATED_READ_SERIALIZATION_ERROR = '40001'

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
   * Gets all requests that were anchored over a month ago, and that are on streams that have had
   * no other requests in the last month.
   * @param options
   * @returns A promise that resolves to an array of request
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
   * @param status
   * @param options
   * @returns A promise that resolves to an array of request with the given status
   */
  public async findByStatus(status: RequestStatus, options: LimitOptions = {}): Promise<Request[]> {
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
      .update({ ...fields, updatedAt: updatedAt })
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
          isolationLevel: 'repeatable read',
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
    const anchoringDeadline = new Date(now.getTime() - MAX_ANCHORING_DELAY_MS)

    return connection.transaction(
      async (trx) => {
        const streamsToAnchor = await findStreamsToAnchor(trx, maxStreamLimit, now)

        // Do not anchor if there are no streams to anchor
        if (streamsToAnchor.length === 0) {
          logger.debug(`Not updating any requests to READY because there are no streams to anchor`)
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

          logger.debug(`Updated ${updatedCount} requests to READY`)

          return requests
        }

        logger.debug(
          `Not updating any requests to READY because there are not enough streams for a batch ${streamsToAnchor.length}/${minStreamLimit} and the earliest request is not expired (created at ${streamsToAnchor[0].minCreatedAt})`
        )

        return []
      },
      {
        isolationLevel: 'repeatable read',
      }
    )
  }

  /**
   * Finds a request with the given CID if exists
   * @param cid CID the request is for
   * @param options
   * @returns request
   */
  public async findByCid(cid: CID, options: Options = {}): Promise<Request> {
    const { connection = this.connection } = options

    return connection(TABLE_NAME).where({ cid: cid.toString() }).first()
  }

  /**
   * For test use. Creates an array of requests.
   * @param requests array of requests
   * @param options
   * @returns
   */
  public async createRequests(requests: Array<Request>, options: Options = {}): Promise<void> {
    const { connection = this.connection } = options

    return connection.table(TABLE_NAME).insert(requests)
  }
}
