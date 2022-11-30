import { AnchorRepository } from '../repositories/anchor-repository.js'
import { Request, InvalidRequestStatusError, RequestStatus } from '../models/request.js'
import { Config } from 'node-config-ts'

/**
 * Render anchoring Request as JSON for a client to consume.
 */
export class RequestPresentationService {
  private readonly schedulerIntervalMS: number

  static inject = ['config', 'anchorRepository'] as const

  constructor(config: Config, private readonly anchorRepository: AnchorRepository) {
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
      case RequestStatus.PENDING: {
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
      case RequestStatus.READY:
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
