import type { Request } from '../models/request.js'
import { InvalidRequestStatusError, RequestStatus } from '../models/request.js'
import type { IAnchorRepository } from '../repositories/anchor-repository.type.js'

export type CommitPresentation = {
  content: { path: string | undefined; prev: string; proof: string | undefined }
  cid: string
}

export type NotCompletedRequestPresentation = {
  createdAt: number
  streamId: string
  id: string
  message: string
  status: string
  cid: string
  updatedAt: number
}

export type CompletedRequestPresentation = NotCompletedRequestPresentation & {
  anchorCommit: CommitPresentation
}

export type RequestPresentation = NotCompletedRequestPresentation | CompletedRequestPresentation

/**
 * Render anchoring Request as JSON for a client to consume.
 */
export class RequestPresentationService {
  static inject = ['anchorRepository'] as const

  constructor(private readonly anchorRepository: IAnchorRepository) {}

  /**
   * Rich JSON of a request.
   *
   * @param request - Request to be rendered as JSON.
   */
  async body(request: Request): Promise<RequestPresentation> {
    const status = request.status as RequestStatus
    switch (status) {
      case RequestStatus.COMPLETED: {
        const anchor = await this.anchorRepository.findByRequest(request)
        // TODO: This is a workaround, fix in CDB-2192
        const anchorCommit = {
          cid: anchor ? anchor.cid.toString() : request.cid,
          content: {
            // okay to be undefined because it is not used by ceramic node
            path: anchor?.path,
            prev: request.cid,
            // okay to be undefined because it is not used by ceramic node
            proof: anchor?.proofCid.toString(),
          },
        }

        return {
          id: request.id,
          status: RequestStatus[status],
          cid: request.cid,
          streamId: request.streamId,
          message: request.message,
          createdAt: request.createdAt?.getTime(),
          updatedAt: request.updatedAt?.getTime(),
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
        throw new InvalidRequestStatusError(status)
    }
  }

  /**
   * Vanilla presentation of a non-complete request.
   * Display status as is.
   */
  private notCompleted(request: Request): NotCompletedRequestPresentation {
    return {
      id: request.id,
      status: RequestStatus[request.status!],
      cid: request.cid,
      streamId: request.streamId,
      message: request.message,
      createdAt: request.createdAt?.getTime(),
      updatedAt: request.updatedAt?.getTime(),
    }
  }
}
