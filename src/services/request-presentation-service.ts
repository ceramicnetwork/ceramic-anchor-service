import type { Request } from '../models/request.js'
import { InvalidRequestStatusError, RequestStatus } from '../models/request.js'
import type { IAnchorRepository } from '../repositories/anchor-repository.type.js'
import { AnchorWithRequest } from '../repositories/anchor-repository.type.js'
import type { IMerkleCarService } from './merkle-car-service.js'
import type { WitnessService } from './witness-service.js'
import type { CAR } from 'cartonne'
import {
  AnchorCommitPresentation,
  AnchorRequestStatusName,
  NotCompleteCASResponse,
  CASResponse,
} from '@ceramicnetwork/codecs'
import { CID } from 'multiformats/cid'
import { StreamID } from '@ceramicnetwork/streamid'
import type { OutputOf } from 'codeco'
import { LRUCache } from 'least-recent'
import { ServiceMetrics as Metrics } from '@ceramicnetwork/observability'
import { METRIC_NAMES } from '../settings.js'
import { logger } from '../logger/index.js'

const NAME_FROM_STATUS = {
  [RequestStatus.REPLACED]: AnchorRequestStatusName.REPLACED,
  [RequestStatus.FAILED]: AnchorRequestStatusName.FAILED,
  [RequestStatus.PENDING]: AnchorRequestStatusName.PENDING,
  [RequestStatus.PROCESSING]: AnchorRequestStatusName.PROCESSING,
  [RequestStatus.READY]: AnchorRequestStatusName.READY,
  [RequestStatus.COMPLETED]: AnchorRequestStatusName.READY,
} as const

const WITNESS_CAR_CACHE = 1000 // ~2MiB if one witness car is 2KiB

export class CompletedAnchorlessError extends Error {
  constructor(cid: string) {
    super(`No anchor for COMPLETED request ${cid} found`)
  }
}

class NoMerkleCarError extends Error {
  constructor(proofCID: CID) {
    super(`No MerkleCAR found for proof ${proofCID}`)
  }
}

/**
 * Render anchoring Request as JSON for a client to consume.
 */
export class RequestPresentationService {
  static inject = ['anchorRepository', 'merkleCarService', 'witnessService'] as const

  private readonly cache = new LRUCache<string, CAR>(WITNESS_CAR_CACHE)

  constructor(
    private readonly anchorRepository: IAnchorRepository,
    private readonly merkleCarService: IMerkleCarService,
    private readonly witnessService: WitnessService
  ) {}

  async witnessCAR(anchor: AnchorWithRequest): Promise<CAR> {
    const cacheKey = anchor.cid.toString()
    const fromCache = this.cache.get(cacheKey)
    if (fromCache) {
      Metrics.count(METRIC_NAMES.MERKLE_CAR_CACHE_HIT, 1)
      return fromCache
    }
    Metrics.count(METRIC_NAMES.MERKLE_CAR_CACHE_MISS, 1)
    const merkleCAR = await this.merkleCarService.retrieveCarFile(anchor.proofCid)
    if (!merkleCAR) {
      Metrics.count(METRIC_NAMES.NO_MERKLE_CAR_FOR_ANCHOR, 1)
      logger.warn(`No Merkle CAR found for anchor ${anchor.cid}`)
      throw new NoMerkleCarError(anchor.proofCid)
    }
    const witnessCAR = this.witnessService.buildWitnessCAR(anchor.cid, merkleCAR)
    this.cache.set(cacheKey, witnessCAR)
    return witnessCAR
  }

  async response(request: Request): Promise<CASResponse> {
    const status = request.status as RequestStatus
    switch (status) {
      case RequestStatus.COMPLETED: {
        const anchor = await this.anchorRepository.findByRequest(request)
        if (!anchor) {
          Metrics.count(METRIC_NAMES.NO_ANCHOR_FOR_REQUEST, 1)
          throw new CompletedAnchorlessError(request.cid)
        }
        const witnessCAR = await this.witnessCAR(anchor)
        // TODO CDB-2759 Drop this after enough Ceramic nodes can 100% rely on WitnessCAR
        const anchorCommit: AnchorCommitPresentation = {
          cid: anchor ? anchor.cid : CID.parse(request.cid),
        }

        return {
          id: request.id,
          status: AnchorRequestStatusName.COMPLETED,
          cid: CID.parse(request.cid),
          streamId: StreamID.fromString(request.streamId),
          message: request.message,
          createdAt: new Date(request.createdAt),
          updatedAt: new Date(request.updatedAt),
          anchorCommit: anchorCommit,
          witnessCar: witnessCAR,
        }
      }
      case RequestStatus.PENDING:
      case RequestStatus.PROCESSING:
      case RequestStatus.FAILED:
      case RequestStatus.READY:
      case RequestStatus.REPLACED:
        return this.notCompleted(request, status)
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
