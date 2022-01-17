import { DBConnection } from '../../services/__tests__/db-connection.js'
import { container } from 'tsyringe'
import { config } from 'node-config-ts'
import { RequestRepository } from '../request-repository.js'
import { AnchorRepository } from '../anchor-repository.js'
import { Request } from '../../models/request.js'
import { randomCID } from '../../test-utils.js'
import { StreamID } from '@ceramicnetwork/streamid'
import { RequestStatus } from '../../models/request-status.js'

async function generateCompletedRequest(expired: boolean, failed: boolean): Promise<Request> {
  const request = new Request()
  const cid = await randomCID()
  request.cid = cid.toString()
  request.streamId = new StreamID('tile', cid).toString()
  request.status = failed ? RequestStatus.FAILED : RequestStatus.COMPLETED
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

async function generatePendingRequests(count: number): Promise<Request[]> {
  const now = new Date()
  const requests = []

  for (let i = 0; i < count; i++) {
    const request = new Request()
    const cid = await randomCID()
    request.cid = cid.toString()
    request.streamId = new StreamID('tile', cid).toString()
    request.status = RequestStatus.PENDING
    const createdAt = new Date(now)
    createdAt.setHours(now.getHours() + i)
    request.createdAt = createdAt

    requests.push(request)
  }

  return requests
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
      generateCompletedRequest(false, false),
      generateCompletedRequest(true, false),
      generateCompletedRequest(false, true),
      generateCompletedRequest(true, true),
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
      generateCompletedRequest(false, false),
      generateCompletedRequest(true, false),
      generateCompletedRequest(false, true),
      generateCompletedRequest(true, true),
    ])

    // Set an expired and non-expired request to be on the same streamId. The expired request should
    // not show up to be garbage collected.
    requests[3].streamId = requests[2].streamId

    await requestRepository.createRequests(requests)

    const expiredRequests = await requestRepository.findRequestsToGarbageCollect()
    expect(expiredRequests.length).toEqual(1)
    expect(expiredRequests[0].cid).toEqual(requests[1].cid)
  })

  test('Process requests oldest to newest', async () => {
    const requestRepository = container.resolve<RequestRepository>('requestRepository')

    const requests = await generatePendingRequests(2)
    await requestRepository.createRequests(requests)
    const loadedRequests = await requestRepository.findNextToProcess(100)

    expect(loadedRequests.length).toEqual(2)
    expect(loadedRequests[0].createdAt.getTime()).toBeLessThan(
      loadedRequests[1].createdAt.getTime()
    )
    expect(loadedRequests[0].cid).toEqual(requests[0].cid)
    expect(loadedRequests[1].cid).toEqual(requests[1].cid)
  })
})
