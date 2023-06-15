import type { Request } from '../models/request.js'
import { InvalidRequestStatusError, RequestStatus } from '../models/request.js'
import type { IAnchorRepository } from '../repositories/anchor-repository.type.js'
import { AnchorWithRequest } from '../repositories/anchor-repository.type.js'
import type { IMerkleCarService } from './merkle-car-service.js'
import type { WitnessService } from './witness-service.js'
import type { CAR } from 'cartonne'
import {
  CASResponse,
  CompleteCASResponse,
  NotCompleteCASResponse,
  CommitPresentation,
} from '../ancillary/anchor-codecs.js'
import { RequestStatusName } from '@ceramicnetwork/anchor-utils'
import { CID } from 'multiformats/cid'
import { StreamID } from '@ceramicnetwork/streamid'
import type { OutputOf } from 'codeco'

const NAME_FROM_STATUS = {
  [RequestStatus.REPLACED]: RequestStatusName.REPLACED,
  [RequestStatus.FAILED]: RequestStatusName.FAILED,
  [RequestStatus.PENDING]: RequestStatusName.PENDING,
  [RequestStatus.PROCESSING]: RequestStatusName.PROCESSING,
  [RequestStatus.READY]: RequestStatusName.READY,
  [RequestStatus.COMPLETED]: RequestStatusName.READY,
} as const

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

  async response(request: Request): Promise<CASResponse> {
    const status = request.status as RequestStatus
    switch (status) {
      case RequestStatus.COMPLETED: {
        const anchor = await this.anchorRepository.findByRequest(request)
        const witnessCAR = await this.witnessCAR(anchor)
        // TODO: This is a workaround, fix in CDB-2192
        const anchorCommit: CommitPresentation = {
          cid: anchor ? anchor.cid : CID.parse(request.cid),
          content: {
            // okay to be undefined because it is not used by ceramic node
            path: anchor?.path,
            prev: CID.parse(request.cid),
            // okay to be undefined because it is not used by ceramic node
            proof: anchor?.proofCid,
          },
        }

        const result: CompleteCASResponse = {
          id: request.id,
          status: RequestStatusName.COMPLETED,
          cid: CID.parse(request.cid),
          streamId: StreamID.fromString(request.streamId),
          message: request.message,
          createdAt: new Date(request.createdAt),
          updatedAt: new Date(request.updatedAt),
          anchorCommit: anchorCommit,
        }
        if (witnessCAR) {
          result.witnessCar = witnessCAR
        }
        return result
      }
      case RequestStatus.PENDING:
      case RequestStatus.PROCESSING:
      case RequestStatus.FAILED:
      case RequestStatus.READY:
        return this.notCompleted(request, status)
      case RequestStatus.REPLACED: {
        const asNotCompleted = this.notCompleted(request, status)
        return {
          ...asNotCompleted,
          status: NAME_FROM_STATUS[RequestStatus.FAILED],
        }
      }
      default:
        throw new InvalidRequestStatusError(status)
    }
  }

  /**
   * Rich JSON of a request.
   *
   * @param request - Request to be rendered as JSON.
   */
  async body(request: Request): Promise<OutputOf<typeof CASResponse>> {
    const response = await this.response(request)
    return CASResponse.encode(response)
  }

  /**
   * Vanilla presentation of a non-complete request.
   * Display status as is.
   */
  private notCompleted<T extends keyof typeof NAME_FROM_STATUS>(
    request: Request,
    status: T
  ): NotCompleteCASResponse {
    return {
      id: request.id,
      status: NAME_FROM_STATUS[status],
      cid: CID.parse(request.cid),
      streamId: StreamID.fromString(request.streamId),
      message: request.message,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    }
  }
}
