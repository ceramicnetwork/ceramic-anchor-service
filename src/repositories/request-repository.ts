import CID from "cids";
import { Connection, EntityRepository, InsertResult, UpdateResult } from 'typeorm';
import { BaseRepository } from 'typeorm-transactional-cls-hooked';

import { Request, RequestUpdateFields } from "../models/request";
import { RequestStatus } from "../models/request-status";
import { logEvent } from '../logger';
import { Config } from 'node-config-ts';
import { inject, singleton } from 'tsyringe';

@singleton()
@EntityRepository(Request)
export default class RequestRepository extends BaseRepository<Request> {

  constructor(
    @inject('config') private config?: Config,
    @inject('dbConnection') private connection?: Connection) {
    super()
  }

  /**
   * Create/updates client request
   * @param request - Request
   */
  public async createOrUpdate(request: Request): Promise<Request> {
    return this.connection.getRepository(Request).save(request);
  }

  /**
   * Creates client requests
   * @param requests - Requests
   */
  public async createRequests(requests: Array<Request>): Promise<InsertResult> {
    return this.connection.getRepository(Request)
      .createQueryBuilder()
      .insert()
      .into(Request)
      .values(requests)
      .execute();
  }

  /**
   * Create/updates client requests
   * @param ids - Request IDs
   * @param fields - Fields to update
   */
  public async updateRequests(fields: RequestUpdateFields, requests: Request[]): Promise<UpdateResult> {
    const ids = requests.map(r => r.id);
    const result = await this.connection.getRepository(Request)
      .createQueryBuilder()
      .update(Request)
      .set(fields)
      .whereInIds(ids)
      .execute().then((result) => {
        requests.map((request) => {
          logEvent.db({
            type: 'request',
            ...request,
            ...fields,
            createdAt: request.createdAt.getTime(),
            updatedAt: request.createdAt.getTime(),
          });
        });
        return result;
      });
    return result;
  }

  /**
   * Gets all requests by status
   */
  public async findNextToProcess(): Promise<Request[]> {
    const now: number = new Date().getTime();
    const deadlineDate = new Date(now - this.config.expirationPeriod);

    return await this.connection.getRepository(Request)
      .createQueryBuilder("request")
      .orderBy("request.createdAt", "DESC")
      .where("request.status = :pendingStatus", { pendingStatus: RequestStatus.PENDING })
      .orWhere("request.status = :processingStatus AND request.updatedAt < :deadlineDate",
        {
          processingStatus: RequestStatus.PROCESSING,
          deadlineDate: deadlineDate.toISOString(),
        })
      .getMany();
  }

  /**
   * Creates new client request
   * @param cid: Client request CID
   */
  public async findByCid(cid: CID): Promise<Request> {
    return await this.connection.getRepository(Request)
      .createQueryBuilder("request")
      .where("request.cid = :cid", { cid: cid.toString() })
      .getOne();
  }
}
