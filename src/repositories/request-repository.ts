import { CID } from 'multiformats/cid'
import type { Connection, EntityManager, InsertResult, UpdateResult } from 'typeorm'
import TypeORM from 'typeorm'
const { EntityRepository, Repository } = TypeORM
import { DateUtils } from 'typeorm/util/DateUtils.js'
export { Repository }
import { Request, RequestUpdateFields, REQUEST_MESSAGES } from '../models/request.js'
import { RequestStatus } from '../models/request-status.js'
import { logEvent } from '../logger/index.js'
import { Config } from 'node-config-ts'
import { inject, singleton } from 'tsyringe'

/**
 * How long we should keep recently anchored streams pinned on our local Ceramic node, to keep the
 * AnchorCommit available to the network.
 */
const ANCHOR_DATA_RETENTION_WINDOW = 1000 * 60 * 60 * 24 * 30 // 30 days
export const MAX_ANCHORING_DELAY_MS = 1000 * 60 * 60 * 12 //12H
export const PROCESSING_TIMEOUT = 1000 * 60 * 60 * 6 //6H
export const FAILURE_RETRY_WINDOW = 1000 * 60 * 60 * 48 // 48H

@singleton()
@EntityRepository(Request)
export class RequestRepository extends Repository<Request> {
  constructor(
    @inject('config') private config?: Config,
    @inject('dbConnection') private connection?: Connection
  ) {
    super()
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
            updatedAt: request.createdAt.getTime(),
          })
        })
        return result
      })
    return result
  }

  /**
   * Gets all requests by status
   */
  public async findNextToProcess(limit: number): Promise<Request[]> {
    const earliestDateToRetry = new Date(Date.now() - FAILURE_RETRY_WINDOW)

    return await this.connection
      .getRepository(Request)
      .createQueryBuilder('request')
      .orderBy('request.created_at', 'ASC')
      .where('request.status = :pendingStatus', { pendingStatus: RequestStatus.PENDING })
      .orWhere(
        'request.status = :failedStatus AND request.createdAt >= :earliestDateToRetry AND (request.message IS NULL OR request.message != :message)',
        {
          failedStatus: RequestStatus.FAILED,
          earliestDateToRetry: DateUtils.mixedDateToUtcDatetimeString(earliestDateToRetry),
          message: REQUEST_MESSAGES.conflictResolutionRejection,
        }
      )
      .limit(limit)
      .getMany()
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
   * Marks requests as READY if (in the order of precendence):
   *  1. there are PROCESSING requests that need to be anchored and retried (the maximum anchoring delay has elapsed and the request hasn't been updated in a long time)
   *  2. there are PENDING requests that need to be anchored (the maximum anchoring delay has elasped)
   *  3. there are streamLimit streams needing an anchor (prioritizing PROCESSING requests that need to be retried, then PENDING requests)
   * Returns the original requests that were marked as READY
   */
  public async findAndMarkReady(streamLimit: number): Promise<Request[]> {
    const anchoringDeadline = new Date(Date.now() - MAX_ANCHORING_DELAY_MS)
    const retryDeadline = new Date(Date.now() - PROCESSING_TIMEOUT)
    const isolationLevel =
      this.connection.options.type === 'sqlite' ? 'SERIALIZABLE' : 'REPEATABLE READ'

    return this.connection.transaction(isolationLevel, async (transactionalEntityManager) => {
      // retrieves up to streamLimit unique streams with their earliest request createdAt value.
      // this will only return streams associated with requests that are PENDING, or PROCESSING and needs to be retried
      const streamsToAnchor = await transactionalEntityManager
        .getRepository(Request)
        .createQueryBuilder('request')
        .select(['request.streamId', 'request.createdAt'])
        .where('request.status = :processingStatus AND request.updatedAt < :retryDeadline', {
          processingStatus: RequestStatus.PROCESSING,
          retryDeadline: DateUtils.mixedDateToUtcDatetimeString(retryDeadline),
        })
        .orWhere('request.status = :pendingStatus', { pendingStatus: RequestStatus.PENDING })
        .orderBy('MIN(request.createdAt)', 'ASC')
        .groupBy('request.streamId')
        .limit(streamLimit)
        .getMany()

      // Do not anchor if the earliest request isn't expired and there isn't enough streams
      const earliestIsNotExpired =
        streamsToAnchor.length > 0 && streamsToAnchor[0].createdAt > anchoringDeadline
      if (earliestIsNotExpired && streamsToAnchor.length < streamLimit) {
        return []
      }

      const streamIds = streamsToAnchor.map(({ streamId }) => streamId)

      // retrieves all requests associated with the streams
      const requests = await transactionalEntityManager
        .getRepository(Request)
        .createQueryBuilder('request')
        .orderBy('request.createdAt', 'ASC')
        .where('request.streamId IN (:...streamIds)', { streamIds })
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

      return requests
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
      .orderBy('request.updatedAt', 'ASC')
      .limit(limit)
      .getMany()
  }
}
