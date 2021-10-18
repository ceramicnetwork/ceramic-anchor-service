import { Connection } from 'typeorm'
import DBConnection from '../../services/__tests__/db-connection'
import { container } from 'tsyringe'
import { config } from 'node-config-ts'
import RequestRepository from '../request-repository'
import AnchorRepository from '../anchor-repository'
import { Request } from '../../models/request'
import { randomCID } from '../../test-utils'
import { StreamID } from '@ceramicnetwork/streamid'
import { RequestStatus } from '../../models/request-status'

async function generateRequest(expired: boolean, streamId?: StreamID): Promise<Request> {
  const request = new Request()
  const cid = await randomCID()
  request.cid = cid.toString()
  request.streamId = streamId ? streamId.toString() : new StreamID('tile', cid).toString()
  request.status = RequestStatus.COMPLETED
  request.message = 'cid anchored successfully'
  request.pinned = true

  const now = new Date()
  request.createdAt = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())
  if (expired) {
    // Request was last updated over a month ago
    request.updatedAt = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate())
  } else {
    // Request was last updated less than a week ago
    request.updatedAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5)
  }

  return request
}

describe('request repository test', () => {
  jest.setTimeout(10000)
  let connection: Connection

  beforeAll(async () => {
    connection = await DBConnection.create()

    container.registerInstance('config', config)
    container.registerInstance('dbConnection', connection)
    container.registerSingleton('anchorRepository', AnchorRepository)
    container.registerSingleton('requestRepository', RequestRepository)
  })

  beforeEach(async () => {
    await DBConnection.clear(connection)
  })

  afterAll(async () => {
    await DBConnection.close(connection)
  })

  test('Finds requests older than a month', async () => {
    const requestRepository = container.resolve<RequestRepository>('requestRepository')

    // Create two requests that are expired and should be garbage collected, and two that should not
    // be.
    const requests = await Promise.all([
      generateRequest(false),
      generateRequest(true),
      generateRequest(false),
      generateRequest(true),
    ])

    await requestRepository.createRequests(requests)

    const expiredRequests = await requestRepository.findRequestsToGarbageCollect()
    expect(expiredRequests.length).toEqual(2)
    expect(expiredRequests[0].cid).toEqual(requests[1].cid)
    expect(expiredRequests[1].cid).toEqual(requests[3].cid)
  })

  test("Don't cleanup streams who have both old and new requests", async () => {
    const requestRepository = container.resolve<RequestRepository>('requestRepository')

    // Create two requests that are expired and should be garbage collected, and two that should not
    // be.
    const requests = await Promise.all([
      generateRequest(false),
      generateRequest(true),
      generateRequest(false),
      generateRequest(true),
    ])

    // Set an expired and non-expired request to be on the same streamId. The expired request should
    // not show up to be garbage collected.
    requests[3].streamId = requests[2].streamId

    await requestRepository.createRequests(requests)

    const expiredRequests = await requestRepository.findRequestsToGarbageCollect()
    expect(expiredRequests.length).toEqual(1)
    expect(expiredRequests[0].cid).toEqual(requests[1].cid)
  })
})
