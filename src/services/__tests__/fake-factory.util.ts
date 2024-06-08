import type { IIpfsService } from '../ipfs-service.type.js'
import type { RequestRepository } from '../../repositories/request-repository.js'
import { StreamID } from '@ceramicnetwork/streamid'
import { randomString } from '@stablelib/random'
import { RequestStatus, Request } from '../../models/request.js'
import { times } from '../../__tests__/test-utils.js'

/**
 * Generate fake data for testing purposes.
 */
export class FakeFactory {
  constructor(readonly ipfsService: IIpfsService, readonly requestRepository: RequestRepository) {}

  async streamId(): Promise<StreamID> {
    const genesisCID = await this.ipfsService.storeRecord({
      header: {
        controllers: [`did:method:${randomString(32)}`],
      },
    })
    return new StreamID(1, genesisCID)
  }

  async request(
    status: RequestStatus = RequestStatus.PENDING,
    streamId?: StreamID
  ): Promise<Request> {
    const actualStreamId = streamId || (await this.streamId())
    const cid = await this.ipfsService.storeRecord({ random: Math.random() })
    const request = new Request()
    request.cid = cid.toString()
    request.streamId = actualStreamId.toString()
    request.status = status
    request.message = 'Request is pending.'
    request.pinned = true

    const stored = await this.requestRepository.create(request)
    if (!stored) {
      throw new Error(`Request with cid ${request.cid} already exists. Cannot create again`)
    }
    await this.requestRepository.markReplaced(stored)
    return stored
  }

  async multipleRequests(n: number, status: RequestStatus = RequestStatus.PENDING) {
    return Promise.all(times(n).map(() => this.request(status)))
  }
}
