import { AnchorRepository } from '../repositories/anchor-repository.js'
import { InvalidRequestStatusError, RequestStatus } from './request-status.js'
import awsCronParser from 'aws-cron-parser'
import { Request } from './request.js'

/**
 * Render anchoring Request as JSON for a client to consume.
 */
export class RequestPresentation {
  constructor(
    private readonly cronExpression: string,
    private readonly anchorRepository: AnchorRepository
  ) {}

  /**
   * Rich JSON of a request.
   *
   * @param request - Request to be rendered as JSON.
   */
  async body(request: Request): Promise<any> {
    switch (request.status) {
      case RequestStatus.COMPLETED: {
        const anchor = await this.anchorRepository.findByRequest(request)
        return {
          id: request.id,
          status: RequestStatus[request.status],
          cid: request.cid,
          docId: request.streamId, // todo remove
          streamId: request.streamId,
          message: request.message,
          createdAt: request.createdAt.getTime(),
          updatedAt: request.updatedAt.getTime(),
          anchorRecord: {
            // TODO: Remove this backwards compatibility field
            cid: anchor.cid,
            content: {
              path: anchor.path,
              prev: anchor.request.cid,
              proof: anchor.proofCid,
            },
          },
          anchorCommit: {
            cid: anchor.cid,
            content: {
              path: anchor.path,
              prev: anchor.request.cid,
              proof: anchor.proofCid,
            },
          },
        }
      }
      case RequestStatus.PENDING: {
        const cron = awsCronParser.parse(this.cronExpression)
        return {
          id: request.id,
          status: RequestStatus[request.status],
          cid: request.cid,
          docId: request.streamId, // TODO remove
          streamId: request.streamId,
          message: request.message,
          createdAt: request.createdAt.getTime(),
          updatedAt: request.updatedAt.getTime(),
          scheduledAt: awsCronParser.next(cron, new Date()),
        }
      }
      case RequestStatus.PROCESSING:
        return {
          id: request.id,
          status: RequestStatus[request.status],
          cid: request.cid,
          docId: request.streamId, // TODO remove
          streamId: request.streamId,
          message: request.message,
          createdAt: request.createdAt.getTime(),
          updatedAt: request.updatedAt.getTime(),
        }
      case RequestStatus.FAILED:
        return {
          id: request.id,
          status: RequestStatus[request.status],
          cid: request.cid,
          docId: request.streamId, // TODO remove
          streamId: request.streamId,
          message: request.message,
          createdAt: request.createdAt.getTime(),
          updatedAt: request.updatedAt.getTime(),
        }
      default:
        throw new InvalidRequestStatusError(request.status)
    }
  }
}
