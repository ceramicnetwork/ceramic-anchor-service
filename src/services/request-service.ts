import type { CID } from 'multiformats/cid'
import type { RequestRepository } from '../repositories/request-repository.js'
import type {
  RequestPresentation,
  RequestPresentationService,
} from './request-presentation-service.js'

export class RequestService {
  static inject = [
    'requestRepository',
    'requestPresentationService',
    'metadataService',
    'anchorRequestParamsParser',
  ] as const

  constructor(
    private readonly requestRepository: RequestRepository,
    private readonly requestPresentationService: RequestPresentationService
  ) {}

  async getStatusForCid(cid: CID): Promise<RequestPresentation | { error: string }> {
    const request = await this.requestRepository.findByCid(cid)
    if (!request) {
      return { error: 'Request does not exist' }
    }

    return this.requestPresentationService.body(request)
  }
}
