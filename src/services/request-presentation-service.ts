import type { Request } from '../models/request.js'
import { InvalidRequestStatusError, RequestStatus } from '../models/request.js'
import type { IAnchorRepository } from '../repositories/anchor-repository.type.js'
import type { IRequestPresentationService } from './request-presentation-service.type.js'

/**
 * Render anchoring Request as JSON for a client to consume.
 */
export class RequestPresentationService implements IRequestPresentationService {
  static inject = ['anchorRepository'] as const

  constructor(private readonly anchorRepository: IAnchorRepository) {}

  /**
   * Rich JSON of a request.
   *
   * @param request - Request to be rendered as JSON.
   */
  async body(request: Request): Promise<any> {
    switch (request.status) {
      case RequestStatus.COMPLETED: {
        const anchor = await this.anchorRepository.findByRequest(request)
        // TODO: This is a workaround, fix in CDB-2192
        const anchorCommit = {
          cid: anchor ? anchor.cid : request.cid,
          content: {
            // okay to be undefined because it is not used by ceramic node
            path: anchor?.path,
            prev: request.cid,
            // okay to be undefined because it is not used by ceramic node
            proof: anchor?.proofCid,
          },
        }

        return {
          id: request.id,
          status: RequestStatus[request.status],
          cid: request.cid,
          docId: request.streamId, // todo remove
          streamId: request.streamId,
          message: request.message,
          createdAt: request.createdAt.getTime(),
          updatedAt: request.updatedAt.getTime(),
          // TODO: Remove this backwards compatibility field
          anchorRecord: anchorCommit,
          anchorCommit,
        }
      }
      case RequestStatus.PENDING:
      case RequestStatus.PROCESSING:
      case RequestStatus.FAILED:
      case RequestStatus.READY:
        return this.notCompleted(request)
      case RequestStatus.REPLACED: {
        const asNotCompleted = this.notCompleted(request)
        return {
          ...asNotCompleted,
          status: RequestStatus[RequestStatus.FAILED],
        }
      }
      default:
        throw new InvalidRequestStatusError(request.status)
    }
  }

  /**
   * Vanilla presentation of a non-complete request.
   * Display status as is.
   */
  private notCompleted(request: Request) {
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
  }
}
