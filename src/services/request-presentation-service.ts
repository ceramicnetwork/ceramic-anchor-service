import type { Request } from '../models/request.js'
import { InvalidRequestStatusError, RequestStatus } from '../models/request.js'
import type { Config } from 'node-config-ts'
import type { IAnchorRepository } from '../repositories/anchor-repository.type.js'

/**
 * Render anchoring Request as JSON for a client to consume.
 */
export class RequestPresentationService {
  private readonly schedulerIntervalMS: number

  static inject = ['config', 'anchorRepository'] as const

  constructor(config: Config, private readonly anchorRepository: IAnchorRepository) {
    this.schedulerIntervalMS = config.schedulerIntervalMS
  }

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
              prev: request.cid,
              proof: anchor.proofCid,
            },
          },
          anchorCommit: {
            cid: anchor.cid,
            content: {
              path: anchor.path,
              prev: request.cid,
              proof: anchor.proofCid,
            },
          },
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
          status: RequestStatus[RequestStatus.PENDING],
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
