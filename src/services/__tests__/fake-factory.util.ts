import type { IIpfsService } from '../ipfs-service.type.js'
import type { IMetadataService } from '../metadata-service.js'
import type { RequestRepository } from '../../repositories/request-repository.js'
import { StreamID } from '@ceramicnetwork/streamid'
import { randomString } from '@stablelib/random'
import { RequestStatus, StoredRequest } from '../../models/request.js'
import { times } from '../../__tests__/test-utils.js'

/**
 * Generate fake data for testing purposes.
 */
export class FakeFactory {
  constructor(
    readonly ipfsService: IIpfsService,
    readonly metadataService: IMetadataService,
    readonly requestRepository: RequestRepository
  ) {}

  async streamId(): Promise<StreamID> {
    const genesisCID = await this.ipfsService.storeRecord({
      header: {
        controllers: [`did:method:${randomString(32)}`],
      },
    })
    const streamId = new StreamID(1, genesisCID)
    await this.metadataService.fillFromIpfs(streamId)
    return streamId
  }

  async request(
    status: RequestStatus = RequestStatus.PENDING,
    streamId?: StreamID
  ): Promise<StoredRequest> {
    const actualStreamId = streamId || (await this.streamId())
    const cid = await this.ipfsService.storeRecord({ random: Math.random() })
    const stored = await this.requestRepository.createOrUpdate({
      status: status,
      cid: cid,
      timestamp: new Date(),
      streamId: actualStreamId,
      origin: 'fake-origin',
      message: '',
    })
    await this.requestRepository.markPreviousReplaced(stored)
    return stored
  }

  async multipleRequests(n: number, status: RequestStatus = RequestStatus.PENDING) {
    return Promise.all(times(n).map(() => this.request(status)))
  }
}
