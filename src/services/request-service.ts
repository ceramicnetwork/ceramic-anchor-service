import { Request } from '../models/request';
import { getManager } from 'typeorm';

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
    req.message = 'Request is pending.';

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
}
