import { Request } from '../models/request';
import { getManager, UpdateResult } from 'typeorm';

import CID from 'cids';
import Context from '../context';
import { RequestStatus } from '../models/request-status';
import Contextual from '../contextual';

export default class RequestService implements Contextual {
  private ctx: Context;

  setContext(context: Context): void {
    this.ctx = context;
  }

  /**
   * Creates new client request
   * @param cid - CID info
   * @param docId - Genesis document ID
   */
  public async create(cid: string, docId: string): Promise<Request> {
    const req: Request = new Request();
    req.cid = cid;
    req.docId = docId;
    req.status = RequestStatus.PENDING;
    req.message = 'Request pending.';

    const reqRepository = getManager().getRepository(Request);
    return reqRepository.save(req);
  }

  /**
   * Updates client request
   * @param request - Request
   */
  public async save(request: Request): Promise<Request> {
    const reqRepository = getManager().getRepository(Request);
    return reqRepository.save(request);
  }

  /**
   * Gets all requests by status
   * @param status - Status of the client request
   */
  public async findByStatus(status: RequestStatus): Promise<Request[]> {
    return await getManager()
      .getRepository(Request)
      .createQueryBuilder('request')
      .orderBy('request.createdAt', 'DESC')
      .where('request.status = :status', { status })
      .getMany();
  }

  /**
   * Creates new client request
   * @param cid: Client request CID
   */
  public async findByCid(cid: CID): Promise<Request> {
    return await getManager()
      .getRepository(Request)
      .createQueryBuilder('request')
      .where('request.cid = :cid', { cid: cid.toString() })
      .getOne();
  }

  /**
   * Sets new status for all requests by old status
   * @param oldStatus - Old status of the client request
   * @param newStatus - New status of the client request
   */
  public async setStatus(oldStatus: RequestStatus, newStatus: RequestStatus): Promise<UpdateResult> {
    return await getManager()
      .getRepository(Request)
      .createQueryBuilder('request')
      .update(Request)
      .set({ status: newStatus })
      .where('request.status = :newStatus', { newStatus })
      .execute();
  }
}
