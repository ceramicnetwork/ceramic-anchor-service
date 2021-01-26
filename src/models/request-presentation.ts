import AnchorRepository from '../repositories/anchor-repository';
import { InvalidRequestStatusError, RequestStatus } from './request-status';
import awsCronParser from 'aws-cron-parser';
import { config } from 'node-config-ts';
import { Request } from './request';

/**
 * Render anchoring Request as JSON for a client to consume.
 */
export class RequestPresentation {
  constructor(private readonly cronExpression: string, private readonly anchorRepository: AnchorRepository) {}

  /**
   * Rich JSON of a request.
   *
   * @param request - Request to be rendered as JSON.
   */
  async body(request: Request): Promise<any> {
    switch (request.status) {
      case RequestStatus.COMPLETED: {
        const anchor = await this.anchorRepository.findByRequest(request);
        return {
          id: request.id,
          status: RequestStatus[request.status],
          cid: request.cid,
          docId: request.docId,
          message: request.message,
          createdAt: request.createdAt.getTime(),
          updatedAt: request.updatedAt.getTime(),
          anchorRecord: {
            cid: anchor.cid,
            content: {
              path: anchor.path,
              prev: anchor.request.cid,
              proof: anchor.proofCid,
            },
          },
        };
      }
      case RequestStatus.PENDING: {
        const cron = awsCronParser.parse(config.cronExpression);
        return {
          id: request.id,
          status: RequestStatus[request.status],
          cid: request.cid,
          docId: request.docId,
          message: request.message,
          createdAt: request.createdAt.getTime(),
          updatedAt: request.updatedAt.getTime(),
          scheduledAt: awsCronParser.next(cron, new Date()),
        };
      }
      case RequestStatus.PROCESSING:
        return {
          id: request.id,
          status: RequestStatus[request.status],
          cid: request.cid,
          docId: request.docId,
          message: request.message,
          createdAt: request.createdAt.getTime(),
          updatedAt: request.updatedAt.getTime(),
        };
      case RequestStatus.FAILED:
        return {
          id: request.id,
          status: RequestStatus[request.status],
          cid: request.cid,
          docId: request.docId,
          message: request.message,
          createdAt: request.createdAt.getTime(),
          updatedAt: request.updatedAt.getTime(),
        };
      default:
        throw new InvalidRequestStatusError(request.status);
    }
  }
}
