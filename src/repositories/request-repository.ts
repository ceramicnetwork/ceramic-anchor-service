import { CID } from 'multiformats/cid'
import type { Connection, EntityManager, InsertResult, UpdateResult } from 'typeorm'
import TypeORM from 'typeorm'
const { EntityRepository, Repository } = TypeORM
export { Repository }
import { Request, RequestUpdateFields, REQUEST_MESSAGES } from '../models/request.js'
import { RequestStatus } from '../models/request-status.js'
import { logEvent } from '../logger/index.js'
import { Config } from 'node-config-ts'
import { inject, singleton } from 'tsyringe'
import { logger } from '../logger/index.js'
import { Utils } from '../utils.js'
import { Metrics } from '@ceramicnetwork/metrics'
import { METRIC_NAMES } from '../settings.js'

/**
 * How long we should keep recently anchored streams pinned on our local Ceramic node, to keep the
 * AnchorCommit available to the network.
 */
const ANCHOR_DATA_RETENTION_WINDOW = 1000 * 60 * 60 * 24 * 30 // 30 days
export const MAX_ANCHORING_DELAY_MS = 1000 * 60 * 60 * 12 //12H
export const PROCESSING_TIMEOUT = 1000 * 60 * 60 * 3 //3H
export const FAILURE_RETRY_WINDOW = 1000 * 60 * 60 * 48 // 48H
const TRANSACTION_MUTEX_ID = 4532
// application is recommended to automatically retry when seeing this error
const REPEATED_READ_SERIALIZATION_ERROR = '40001'

@singleton()
@EntityRepository(Request)
export class RequestRepository extends Repository<Request> {
  private readonly isolationLevel

  constructor(
    @inject('config') private config?: Config,
    @inject('dbConnection') private connection?: Connection
  ) {
    super()
    this.isolationLevel =
      this.connection.options.type === 'sqlite' ? 'SERIALIZABLE' : 'REPEATABLE READ'
  }

  /**
   * Create/updates client request
   * @param request - Request
   */
  public async createOrUpdate(request: Request): Promise<Request> {
    return this.connection.getRepository(Request).save(request)
  }

  /**
   * Creates client requests
   * @param requests - Requests
   */
  public async createRequests(requests: Array<Request>): Promise<InsertResult> {
    return this.connection
      .getRepository(Request)
      .createQueryBuilder()
      .insert()
      .into(Request)
      .values(requests)
      .execute()
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
    manager?: EntityManager
  ): Promise<UpdateResult> {
    if (!manager) {
      manager = this.connection.manager
    }
    const ids = requests.map((r) => r.id)
    const result = await manager
      .getRepository(Request)
      .createQueryBuilder()
      .update(Request)
      .set(fields)
      .whereInIds(ids)
      .execute()
      .then((result) => {
        requests.map((request) => {
          logEvent.db({
            type: 'request',
            ...request,
            ...fields,
            createdAt: request.createdAt.getTime(),
            updatedAt: new Date(Date.now()),
          })
        })
        return result
      })
    return result
  }

  /**
   * Gets all READY requests and marks them as PROCESSING
   */
  public async findAndMarkAsProcessing(): Promise<Request[]> {
    return this.connection
      .transaction(this.isolationLevel, async (transactionalEntityManager) => {
        const requests = await this.findByStatus(RequestStatus.READY, transactionalEntityManager)

        if (requests.length === 0) {
          return []
        }

        const results = await this.updateRequests(
          { status: RequestStatus.PROCESSING },
          requests,
          transactionalEntityManager
        )

        if (!results.affected || results.affected != requests.length) {
          throw Error(
            `A problem occured when updated requests to PROCESSING. Only ${results.affected}/${requests.length} requests were updated`
          )
        }

        return requests
      })
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
   * Creates new client request
   * @param cid: Client request CID
   */
  public async findByCid(cid: CID): Promise<Request> {
    return await this.connection
      .getRepository(Request)
      .createQueryBuilder('request')
      .where('request.cid = :cid', { cid: cid.toString() })
      .getOne()
  }

  /**
   * Gets all requests that were anchored over a month ago, and that are on streams that have had
   * no other requests in the last month.
   */
  public async findRequestsToGarbageCollect(): Promise<Request[]> {
    const now: number = new Date().getTime()
    const deadlineDate = new Date(now - ANCHOR_DATA_RETENTION_WINDOW)

    const expiredRequests = await this.connection
      .getRepository(Request)
      .createQueryBuilder('request')
      .orderBy('request.updated_at', 'DESC')
      .where('(request.status = :anchoredStatus1 OR request.status = :anchoredStatus2)', {
        anchoredStatus1: RequestStatus.COMPLETED,
        anchoredStatus2: RequestStatus.FAILED,
      })
      .andWhere('request.pinned = :pinned', { pinned: true })
      .andWhere('request.updated_at < :deadlineDate', { deadlineDate: deadlineDate.toISOString() })

    return expiredRequests
      .andWhere((qb) => {
        const recentRequestsStreamIds = qb
          .subQuery()
          .select('doc_id')
          .from(Request, 'recent_request')
          .orderBy('recent_request.updated_at', 'DESC')
          .where('recent_request.updated_at >= :deadlineDate', {
            deadlineDate: deadlineDate.toISOString(),
          })
          .getQuery()
        return 'request.doc_id NOT IN ' + recentRequestsStreamIds
      })
      .getMany()
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
    minStreamLimit = maxStreamLimit
  ): Promise<Request[]> {
    const anchoringDeadline = new Date(Date.now() - MAX_ANCHORING_DELAY_MS)
    const processingDeadline = new Date(Date.now() - PROCESSING_TIMEOUT)
    const earliestDateToRetry = new Date(Date.now() - FAILURE_RETRY_WINDOW)

    return this.connection
      .transaction(this.isolationLevel, async (transactionalEntityManager) => {
        // Query that when executed returns all requests that meet one of the following conditions:
        //    - is PENDING,
        //    - is PROCESSING and needs to be retried
        //    - is FAILED, has not expired, and has not been rejected due to confliction resolution
        const allRequestsToAnchorQuery = await transactionalEntityManager
          .getRepository(Request)
          .createQueryBuilder('request')
          .where(
            'request.status = :failedStatus AND request.createdAt >= :earliestDateToRetry AND (request.message IS NULL OR request.message != :message)',
            {
              failedStatus: RequestStatus.FAILED,
              earliestDateToRetry: earliestDateToRetry,
              message: REQUEST_MESSAGES.conflictResolutionRejection,
            }
          )
          .orWhere(
            'request.status = :processingStatus AND request.updatedAt < :processingDeadline',
            {
              processingStatus: RequestStatus.PROCESSING,
              processingDeadline: processingDeadline,
            }
          )
          .orWhere('request.status = :pendingStatus', { pendingStatus: RequestStatus.PENDING })

        // using conditions in allRequestsToAnchorQuery, retrieves up to streamLimit unique streams with their earliest request createdAt value
        const rawStreamsToAnchor = await allRequestsToAnchorQuery
          .clone()
          .select(['request.streamId as sid', 'MIN(request.createdAt) as min_created_at'])
          .groupBy('sid')
          .orderBy('min_created_at', 'ASC')
          // if 0 will return unlimited
          .limit(maxStreamLimit)
          .getRawMany()

        // convert raw results to Request entities
        const streamsToAnchor = transactionalEntityManager.getRepository(Request).create(
          rawStreamsToAnchor.map((request) => ({
            streamId: request['sid'],
            createdAt: request['min_created_at'],
          }))
        )

        // Do not anchor if there are no streams to anhor
        if (streamsToAnchor.length === 0) {
          return []
        }

        // Anchor if we have enough streams or the earliest stream request is expired
        const earliestIsExpired = streamsToAnchor[0].createdAt < anchoringDeadline
        if (streamsToAnchor.length >= minStreamLimit || earliestIsExpired) {
          const streamIds = streamsToAnchor.map(({ streamId }) => streamId)

          // using conditions in allRequestsToAnchorQuery, retrieves all requests associated with the retrieved streams
          const requests = await allRequestsToAnchorQuery
            .orderBy('request.createdAt', 'ASC')
            .andWhere('request.streamId IN (:...streamIds)', { streamIds })
            .getMany()

          const results = await this.updateRequests(
            { status: RequestStatus.READY },
            requests,
            transactionalEntityManager
          )

          // if not all requests are updated
          if (!results.affected || results.affected != requests.length) {
            throw Error(
              `A problem occured when updated requests to READY. Only ${results.affected}/${requests.length} requests were updated`
            )
          }

          const expired = requests.filter((request) => request.createdAt < anchoringDeadline)
          if (expired.length > 0) Metrics.count(METRIC_NAMES.RETRY_EXPIRING, expired.length)

          const processing = requests.filter(
            (request) => request.status === RequestStatus.PROCESSING
          )
          if (processing.length > 0) Metrics.count(METRIC_NAMES.RETRY_PROCESSING, processing.length)

          const failed = requests.filter((request) => request.status === RequestStatus.FAILED)
          if (failed.length > 0) Metrics.count(METRIC_NAMES.RETRY_FAILED, failed.length)

          return requests
        }

        logger.debug(
          'Not updating any requests to READY because there are not enough streams for a batch and the earliest request is not expired'
        )
        return []
      })
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
   */
  public async findByStatus(
    status: RequestStatus,
    manager?: EntityManager,
    limit?: number
  ): Promise<Request[]> {
    manager = manager || this.connection.manager

    return manager
      .getRepository(Request)
      .createQueryBuilder('request')
      .where('request.status = :status', { status })
      .orderBy('request.updated_at', 'ASC')
      .limit(limit)
      .getMany()
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
    delayMS = 5000
  ): Promise<T> {
    return this.connection.transaction(async (transactionalEntityManager) => {
      let attempt = 1
      while (attempt <= maxAttempts) {
        logger.debug(`Attempt ${attempt} at acquiring the transaction mutex before operation`)
        if (attempt > 5) Metrics.count(METRIC_NAMES.MANY_ATTEMPTS_TO_ACQUIRE_MUTEX, 1)

        const [{ pg_try_advisory_xact_lock: success }] = await transactionalEntityManager.query(
          `SELECT pg_try_advisory_xact_lock(${TRANSACTION_MUTEX_ID})`
        )

        if (success) {
          return operation()
        }

        attempt++

        await Utils.delay(delayMS)
      }
      throw new Error(`Failed to acquire transaction mutex after ${maxAttempts} tries`)
    })
  }
}
