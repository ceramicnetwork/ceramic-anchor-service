import { InvalidRequestStatusError, RequestStatus } from '../models/request.js'
import type { Request } from '../models/request.js'
import type { IAnchorRepository } from '../repositories/anchor-repository.type.js'
import type { IMerkleCarService } from './merkle-car-service.js'
import { AnchorWithRequest } from '../repositories/anchor-repository.type.js'
import type { WitnessService } from './witness-service.js'
import type { CAR } from 'cartonne'
import { uint8ArrayAsBase64 } from '@ceramicnetwork/codecs'

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
  witnessCAR: string
}

export type RequestPresentation = NotCompletedRequestPresentation | CompletedRequestPresentation

/**
 * Render anchoring Request as JSON for a client to consume.
 */
export class RequestPresentationService {
  static inject = ['anchorRepository', 'merkleCarService', 'witnessService'] as const

  constructor(
    private readonly anchorRepository: IAnchorRepository,
    private readonly merkleCarService: IMerkleCarService,
    private readonly witnessService: WitnessService
  ) {}

  async witnessCAR(anchor: AnchorWithRequest | null): Promise<CAR | null> {
    if (!anchor) return null // TODO Add metric
    const merkleCAR = await this.merkleCarService.retrieveCarFile(anchor.proofCid)
    if (!merkleCAR) return null // TODO Add metric
    return this.witnessService.buildWitnessCAR(anchor.cid, merkleCAR)
  }

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
        const witnessCAR = await this.witnessCAR(anchor)
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

        const result: any = {
          id: request.id,
          status: RequestStatus[status],
          cid: request.cid,
          streamId: request.streamId,
          message: request.message,
          createdAt: request.createdAt?.getTime(),
          updatedAt: request.updatedAt?.getTime(),
          anchorCommit: anchorCommit,
        }
        if (witnessCAR) {
          result.witnessCAR = uint8ArrayAsBase64.encode(witnessCAR.bytes)
        }
        return result
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
