import type { CID } from 'multiformats/cid'
import { ServiceMetrics as Metrics } from '@ceramicnetwork/observability'
import { METRIC_NAMES } from '../settings.js'
import type { RequestRepository } from '../repositories/request-repository.js'
import type {
  RequestPresentation,
  RequestPresentationService,
} from './request-presentation-service.js'
import type { RequestAnchorParams } from '../ancillary/anchor-request-params-parser.js'
import type { IMetadataService } from './metadata-service.js'
import type { GenesisFields } from '../models/metadata'
import { Request, RequestStatus } from '../models/request.js'

export class RequestService {
  static inject = [
    'requestRepository',
    'requestPresentationService',
    'metadataService',
    'anchorRequestParamsParser',
  ] as const

  constructor(
    private readonly requestRepository: RequestRepository,
    private readonly requestPresentationService: RequestPresentationService,
    private readonly metadataService: IMetadataService
  ) {}

  async getStatusForCid(cid: CID): Promise<RequestPresentation | { error: string }> {
    const request = await this.requestRepository.findByCid(cid)
    if (!request) {
      return { error: 'Request does not exist' }
    }

    return this.requestPresentationService.body(request)
  }

  async findByCid(cid: CID): Promise<RequestPresentation | undefined> {
    const found = await this.requestRepository.findByCid(cid)
    if (!found) return undefined
    return this.requestPresentationService.body(found)
  }

  async createOrUpdate(params: RequestAnchorParams, origin: string): Promise<RequestPresentation> {
    let genesisFields : GenesisFields
    if ('genesisFields' in params) {
      genesisFields = params.genesisFields
      await this.metadataService.fill(params.streamId, params.genesisFields)
    } else {
      genesisFields = await this.metadataService.fillFromIpfs(params.streamId)
    }

    const request = new Request()
    request.cid = params.cid.toString()
    request.origin = origin
    request.streamId = params.streamId.toString()
    request.status = RequestStatus.PENDING
    request.message = 'Request is pending.'
    // We don't actually know with certainty that the stream is pinned, since the pinStream
    // call above can fail and swallows errors, but marking it as pinned incorrectly is harmless,
    // and this way we ensure the request is picked up by garbage collection.
    request.pinned = true
    request.timestamp = params.timestamp ?? new Date()

    const storedRequest = await this.requestRepository.createOrUpdate(request)
    await this.requestRepository.markPreviousReplaced(storedRequest)

    let did;
    if genesisFields && (Array.isArray(genesisFields.controllers) && genesisFields.controllers.length > 0) {
      did = genesisFields.controllers[0];
    }

    Metrics.count(METRIC_NAMES.WRITE_TOTAL_TSDB, 1, {
      cid: request.cid,
      did,
      schema: genesisFields.schema,
      family: genesisFields.family,
      model: genesisFields.model
    })

    return this.requestPresentationService.body(storedRequest)
  }
}
