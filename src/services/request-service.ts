import { Request, RequestUpdateFields } from "../models/request";
import { UpdateResult } from "typeorm";

import CID from "cids";
import Context from "../context";
import Contextual from "../contextual";
import RequestRepository from "../repositories/request-repository";
import { RequestStatus as RS } from "../models/request-status";
import { Transactional } from "typeorm-transactional-cls-hooked";

export default class RequestService implements Contextual {
  private ctx: Context;
  private requestRepository: RequestRepository;

  /**
   * Set application context
   * @param context
   */
  setContext(context: Context): void {
    this.ctx = context;
    this.requestRepository = this.ctx.lookup('RequestRepository')
  }

  /**
   * Creates new client request
   * @param cid: Client request CID
   */
  public async findByCid(cid: CID): Promise<Request> {
    return this.requestRepository.findByCid(cid);
  }

  /**
   * Create/updates client request
   * @param request - Request
   */
  public async createOrUpdate(request: Request): Promise<Request> {
    return this.requestRepository.createOrUpdate(request);
  }

  /**
   * Create/updates client requests
   * @param ids - Request IDs
   * @param fields - Fields to update
   */
  @Transactional()
  public async updateRequests(fields: RequestUpdateFields, ids: number[]): Promise<UpdateResult> {
    return this.requestRepository.updateRequests(fields, ids)
  }

  /**
   * Gets all requests by status
   */
  @Transactional()
  public async findNextToProcess(): Promise<Request[]> {
    const reqs = await this.requestRepository.findNextToProcess();
    await this.requestRepository.updateRequests({ status: RS.PROCESSING, message: 'Request is processing.' }, reqs.map(r => r.id))
    return reqs;
  }

}
