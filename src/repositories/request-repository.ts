import { CID } from 'multiformats/cid'
import type { Connection, EntityManager, InsertResult, UpdateResult } from 'typeorm'
import TypeORM from 'typeorm'
const { EntityRepository, Repository } = TypeORM
export { Repository }

import { Request, RequestUpdateFields } from '../models/request.js'
import { RequestStatus } from '../models/request-status.js'
import { logEvent } from '../logger/index.js'
import { Config } from 'node-config-ts'
import { inject, singleton } from 'tsyringe'

/**
 * How long we should keep recently anchored streams pinned on our local Ceramic node, to keep the
 * AnchorCommit available to the network.
 */
const ANCHOR_DATA_RETENTION_WINDOW = 1000 * 60 * 60 * 24 * 30 // 30 days

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
    const now: number = new Date().getTime()
    const deadlineDate = new Date(now - this.config.expirationPeriod)

    return await this.connection
      .getRepository(Request)
      .createQueryBuilder('request')
      .orderBy('request.created_at', 'ASC')
      .where('request.status = :pendingStatus', { pendingStatus: RequestStatus.PENDING })
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
}
