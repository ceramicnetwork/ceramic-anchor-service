import { Request, RequestUpdateFields } from "../models/request";
import {
  EntityManager,
  getManager,
  InsertResult,
  UpdateResult
} from "typeorm";

import CID from "cids";
import Context from "../context";
import { RequestStatus } from "../models/request-status";
import Contextual from "../contextual";
import { config } from "node-config-ts";

export default class RequestService implements Contextual {
  private ctx: Context;

  /**
   * Set application context
   * @param context
   */
  setContext(context: Context): void {
    this.ctx = context;
  }

  /**
   * Create/updates client request
   * @param request - Request
   * @param providedManager - Provided EntityManager instance
   */
  public async createOrUpdate(request: Request, providedManager?: EntityManager): Promise<Request> {
    const manager = providedManager ? providedManager : getManager();

    return manager.getRepository(Request).save(request);
  }

  /**
   * Creates client requests
   * @param requests - Requests
   * @param providedManager - Provided EntityManager instance
   */
  public async insert(requests: Array<Request>, providedManager?: EntityManager): Promise<InsertResult> {
    const manager = providedManager ? providedManager : getManager();

    return manager.getRepository(Request)
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
   * @param providedManager - Provided EntityManager instance
   */
  public async update(fields: RequestUpdateFields, ids: number[], providedManager?: EntityManager): Promise<UpdateResult> {
    const manager = providedManager ? providedManager : getManager();

    return manager.getRepository(Request)
      .createQueryBuilder()
      .update(Request)
      .set(fields)
      .whereInIds(ids)
      .execute();
  }

  /**
   * Gets all requests by status
   * @param providedManager - Provided EntityManager instance
   */
  public async findNextToProcess(providedManager?: EntityManager): Promise<Request[]> {
    const manager = providedManager ? providedManager : getManager();

    const now: number = new Date().getTime();
    const deadlineDate = new Date(now - config.expirationPeriod);

    return await manager.getRepository(Request)
      .createQueryBuilder("request")
      .orderBy("request.createdAt", "DESC")
      .where("request.status = :pendingStatus", { pendingStatus: RequestStatus.PENDING })
      .orWhere("request.status = :processingStatus AND request.updatedAt < :deadlineDate",
        {
          processingStatus: RequestStatus.PROCESSING,
          deadlineDate
        })
      .getMany();
  }

  /**
   * Creates new client request
   * @param cid: Client request CID
   * @param providedManager - Provided EntityManager instance
   */
  public async findByCid(cid: CID, providedManager?: EntityManager): Promise<Request> {
    const manager = providedManager ? providedManager : getManager();

    return await manager.getRepository(Request)
      .createQueryBuilder("request")
      .where("request.cid = :cid", { cid: cid.toString() })
      .getOne();
  }
}
