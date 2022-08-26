import 'reflect-metadata'
import { jest } from '@jest/globals'
import type { Connection } from 'typeorm'
import { DBConnection } from '../../services/__tests__/db-connection.js'
import { container } from 'tsyringe'
import { config } from 'node-config-ts'
import {
  RequestRepository,
  MAX_ANCHORING_DELAY_MS,
  PROCESSING_TIMEOUT,
  FAILURE_RETRY_WINDOW,
} from '../request-repository.js'
import { AnchorRepository } from '../anchor-repository.js'
import { Request, REQUEST_MESSAGES } from '../../models/request.js'
import { randomCID, generateRequests } from '../../test-utils.js'
import { StreamID } from '@ceramicnetwork/streamid'
import { RequestStatus } from '../../models/request-status.js'
import { Utils } from '../../utils.js'
import { CID } from 'multiformats/cid'

const MS_IN_MINUTE = 1000 * 60
const MS_IN_HOUR = MS_IN_MINUTE * 60
const MS_IN_DAY = MS_IN_HOUR * 24
const MS_IN_MONTH = MS_IN_DAY * 30

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

async function generateReadyRequests(count: number): Promise<Request[]> {
  const now = new Date()
  const requests: Request[] = []

  for (let i = 0; i < count; i++) {
    const request = new Request()
    const cid = await randomCID()
    request.cid = cid.toString()
    request.streamId = new StreamID('tile', cid).toString()
    request.status = RequestStatus.READY
    const createdAt = new Date(now)
    createdAt.setHours(now.getHours() + i)
    request.createdAt = createdAt

    requests.push(request)
  }

  return requests
}

async function getAllRequests(connection): Promise<Request[]> {
  return await connection
    .getRepository(Request)
    .createQueryBuilder('request')
    .orderBy('request.createdAt', 'ASC')
    .getMany()
}

describe('request repository test', () => {
  jest.setTimeout(10000)
  let connection: Connection
  let requestRepository: RequestRepository
  let connection2: Connection

  beforeAll(async () => {
    connection = await DBConnection.create()
    connection2 = await DBConnection.create()

    container.registerInstance('config', config)
    container.registerInstance('dbConnection', connection)
    container.registerSingleton('anchorRepository', AnchorRepository)
    container.registerSingleton('requestRepository', RequestRepository)

    requestRepository = container.resolve<RequestRepository>('requestRepository')
  })

  beforeEach(async () => {
    await DBConnection.clear(connection)
    await DBConnection.clear(connection2)
  })

  afterAll(async () => {
    await DBConnection.close(connection)
  })

  test('Can createOrUpdate simultaneously', async () => {
    const request = await generateRequests(
      {
        status: RequestStatus.READY,
      },
      1
    )

    const [result1, result2] = await Promise.all([
      requestRepository.createOrUpdate(request[0]),
      requestRepository.createOrUpdate(request[0]),
    ])
    expect(result1).toEqual(result2)
  })

  test('Finds requests older than a month', async () => {
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
    const requests = await generateReadyRequests(2)
    await requestRepository.createRequests(requests)
    const loadedRequests = await requestRepository.findAndMarkAsProcessing()

    expect(loadedRequests.length).toEqual(2)
    expect(loadedRequests[0].createdAt.getTime()).toBeLessThan(
      loadedRequests[1].createdAt.getTime()
    )
    expect(loadedRequests[0].cid).toEqual(requests[0].cid)
    expect(loadedRequests[1].cid).toEqual(requests[1].cid)
  })

  test('Retrieves all requests of a specified status', async () => {
    const requests = await Promise.all([
      generateRequests(
        {
          status: RequestStatus.READY,
        },
        3
      ),
      generateRequests(
        {
          status: RequestStatus.PENDING,
        },
        3
      ),
    ]).then((arr) => arr.flat())

    await requestRepository.createRequests(requests)

    const createdRequests = await getAllRequests(connection)
    expect(requests.length).toEqual(createdRequests.length)

    const expected = createdRequests.filter(({ status }) => status === RequestStatus.READY)
    const received = await requestRepository.findByStatus(RequestStatus.READY)

    expect(received).toEqual(expected)
  })

  describe('findAndMarkReady', () => {
    test('Marks pending requests as ready', async () => {
      const streamLimit = 5
      const requests = await Promise.all([
        // pending requests created now
        generateRequests({ status: RequestStatus.PENDING }, streamLimit),
        // completed requests (created 2 months ago, completed 1 month ago)
        generateRequests(
          {
            status: RequestStatus.COMPLETED,
            createdAt: new Date(Date.now() - 2 * MS_IN_MONTH),
            updatedAt: new Date(Date.now() - MS_IN_MONTH),
            pinned: true,
          },
          2
        ),
      ]).then((arr) => arr.flat())

      await requestRepository.createRequests(requests)

      const createdRequests = await getAllRequests(connection)
      expect(requests.length).toEqual(createdRequests.length)

      const updatedRequests = await requestRepository.findAndMarkReady(streamLimit)
      expect(updatedRequests.length).toEqual(streamLimit)

      const pendingRequests = createdRequests.filter(
        ({ status }) => RequestStatus.PENDING === status
      )
      expect(updatedRequests.map(({ cid }) => cid)).toEqual(pendingRequests.map(({ cid }) => cid))
    })

    test('Marks no requests as ready if there are not enough streams', async () => {
      const streamLimit = 5
      const requests = await Promise.all([
        // pending requests created now
        generateRequests({ status: RequestStatus.PENDING }, streamLimit - 1),
        // failed requests (created 2 months ago, failed 1 month ago)
        generateRequests(
          {
            status: RequestStatus.FAILED,
            createdAt: new Date(Date.now() - 2 * MS_IN_MONTH),
            updatedAt: new Date(Date.now() - MS_IN_MONTH),
            pinned: true,
          },
          2
        ),
      ]).then((arr) => arr.flat())

      await requestRepository.createRequests(requests)

      const updatedRequests = await requestRepository.findAndMarkReady(streamLimit)
      expect(updatedRequests.length).toEqual(0)
    })

    test('Marks expired pending request as ready even if there are not enough streams', async () => {
      const streamLimit = 5
      // 13 hours ago (delay is 12 hours)
      const creationDateOfExpiredRequest = new Date(
        Date.now() - MAX_ANCHORING_DELAY_MS - MS_IN_HOUR
      )
      const requests = await Promise.all([
        // expired pending request
        generateRequests(
          {
            status: RequestStatus.PENDING,
            createdAt: creationDateOfExpiredRequest,
            updatedAt: creationDateOfExpiredRequest,
          },
          1
        ),
        // pending request created now
        generateRequests({ status: RequestStatus.PENDING }, 1),
      ]).then((arr) => arr.flat())

      await requestRepository.createRequests(requests)

      const createdRequests = await getAllRequests(connection)
      expect(requests.length).toEqual(createdRequests.length)

      const updatedRequests = await requestRepository.findAndMarkReady(streamLimit)
      expect(updatedRequests.length).toEqual(createdRequests.length)

      expect(updatedRequests.map(({ cid }) => cid)).toEqual(createdRequests.map(({ cid }) => cid))
    })

    test('Marks only streamLimit requests as READY even if there are more', async () => {
      const streamLimit = 5

      // pending requests created now
      const requests = await generateRequests({ status: RequestStatus.PENDING }, streamLimit + 2)

      await requestRepository.createRequests(requests)

      const createdRequests = await getAllRequests(connection)
      expect(createdRequests.length).toEqual(requests.length)

      const updatedRequests = await requestRepository.findAndMarkReady(streamLimit)
      expect(updatedRequests.length).toEqual(streamLimit)

      const earliestPendingRequestCids = createdRequests.map(({ cid }) => cid).slice(0, streamLimit)

      expect(updatedRequests.map(({ cid }) => cid)).toEqual(earliestPendingRequestCids)
    })

    test('Marks processing requests as ready if they need to be retried', async () => {
      const streamLimit = 5
      // 4h ago (timeout is 3h)
      const dateOfTimedOutProcessingRequest = new Date(Date.now() - PROCESSING_TIMEOUT - MS_IN_HOUR)

      const expiredProcessing = await generateRequests(
        // processing request that needs to be retried
        {
          status: RequestStatus.PROCESSING,
          createdAt: new Date(Date.now() - MS_IN_HOUR * 24),
          updatedAt: dateOfTimedOutProcessingRequest,
        },
        1
      )
      const requests = await Promise.all([
        expiredProcessing,
        // requests that are currently processing
        generateRequests(
          {
            status: RequestStatus.PROCESSING,
            createdAt: new Date(Date.now() - MS_IN_MINUTE * 45),
            updatedAt: new Date(Date.now() - MS_IN_MINUTE * 30),
          },
          4
        ),
        // pending requests created now
        generateRequests({ status: RequestStatus.PENDING }, streamLimit),
      ]).then((arr) => arr.flat())

      await requestRepository.createRequests(requests)

      const createdRequests = await getAllRequests(connection)
      expect(createdRequests.length).toEqual(requests.length)

      const updatedRequests = await requestRepository.findAndMarkReady(streamLimit)
      expect(updatedRequests.length).toEqual(streamLimit)

      // get earliest 4 pending as the expired processing request should be the first one
      const earliestPendingRequestCids = createdRequests
        .filter(({ status }) => status === RequestStatus.PENDING)
        .slice(0, streamLimit - 1)
        .map(({ cid }) => cid)

      expect(updatedRequests.map(({ cid }) => cid)).toEqual([
        expiredProcessing[0].cid,
        ...earliestPendingRequestCids,
      ])
    })

    test('Marks requests for same streams as ready', async () => {
      const streamLimit = 5
      const repeatedStreamId = new StreamID('tile', await randomCID()).toString()
      const requests = await Promise.all([
        // repeated request created an hour ago
        generateRequests(
          {
            status: RequestStatus.PENDING,
            createdAt: new Date(Date.now() - MS_IN_HOUR),
            updatedAt: new Date(Date.now() - MS_IN_HOUR),
            streamId: repeatedStreamId,
          },
          1
        ),
        // repeated request created now
        generateRequests(
          {
            status: RequestStatus.PENDING,
            streamId: repeatedStreamId,
          },
          1
        ),
        // other requests
        generateRequests(
          {
            status: RequestStatus.PENDING,
          },
          streamLimit
        ),
      ]).then((arr) => arr.flat())
      const repeatedRequest1 = requests[0]
      const repeatedRequest2 = requests[1]

      await requestRepository.createRequests(requests)

      const createdRequest = await getAllRequests(connection)
      expect(createdRequest.length).toEqual(requests.length)

      const updatedRequests = await requestRepository.findAndMarkReady(streamLimit)
      expect(updatedRequests.length).toEqual(streamLimit + 1)

      const updatedRequestCids = updatedRequests.map(({ cid }) => cid)
      expect(updatedRequestCids).toContain(repeatedRequest1.cid)
      expect(updatedRequestCids).toContain(repeatedRequest2.cid)
    })

    test('Does not mark irrelevant requests as READY if a new request comes in for a stream', async () => {
      const repeatedStreamId = new StreamID('tile', await randomCID()).toString()

      const shouldBeIncluded = await Promise.all([
        // PENDING created now
        generateRequests(
          {
            status: RequestStatus.PENDING,
            streamId: repeatedStreamId,
          },
          1
        ),
        // failed request updated 30 minutes ago
        generateRequests(
          {
            status: RequestStatus.FAILED,
            streamId: repeatedStreamId,
            createdAt: new Date(Date.now() - MS_IN_HOUR),
            updatedAt: new Date(Date.now() - MS_IN_MINUTE * 30),
          },
          1
        ),
        // PROCESSING request updated 4 hours ago
        generateRequests(
          {
            status: RequestStatus.PROCESSING,
            streamId: repeatedStreamId,
            createdAt: new Date(Date.now() - MS_IN_HOUR * 5),
            updatedAt: new Date(Date.now() - MS_IN_HOUR * 4),
          },
          1
        ),
      ]).then((arr) => arr.flat())

      const shouldNotBeIncluded = await Promise.all([
        // completed request created two hours ago
        generateRequests(
          {
            status: RequestStatus.COMPLETED,
            streamId: repeatedStreamId,
            createdAt: new Date(Date.now() - MS_IN_HOUR * 2),
            updatedAt: new Date(Date.now() - MS_IN_HOUR),
          },
          1
        ),
        // failed request that expired (created 3 days ago)
        generateRequests(
          {
            status: RequestStatus.FAILED,
            streamId: repeatedStreamId,
            createdAt: new Date(Date.now() - MS_IN_HOUR * 72),
            updatedAt: new Date(Date.now() - MS_IN_HOUR),
          },
          1
        ),
        // request that is processing
        generateRequests(
          {
            status: RequestStatus.PROCESSING,
            streamId: repeatedStreamId,
            createdAt: new Date(Date.now() - MS_IN_HOUR * 2),
            updatedAt: new Date(Date.now() - MS_IN_HOUR),
          },
          1
        ),
        // request that is READY
        generateRequests(
          {
            status: RequestStatus.READY,
            streamId: repeatedStreamId,
            createdAt: new Date(Date.now() - MS_IN_HOUR),
            updatedAt: new Date(Date.now() - MS_IN_MINUTE * 5),
          },
          1
        ),
      ]).then((arr) => arr.flat())

      const requests = shouldBeIncluded.concat(shouldNotBeIncluded)
      await requestRepository.createRequests(requests)

      const createdRequest = await getAllRequests(connection)
      expect(createdRequest.length).toEqual(requests.length)

      const updatedRequests = await requestRepository.findAndMarkReady(1)
      expect(updatedRequests.length).toEqual(shouldBeIncluded.length)

      const updatedRequestCids = updatedRequests.map(({ cid }) => cid).sort()
      expect(updatedRequestCids).toEqual(shouldBeIncluded.map(({ cid }) => cid).sort())
    })

    test('Does not mark any requests as ready if an error occurs', async () => {
      const streamLimit = 5
      const requests = await generateRequests(
        {
          status: RequestStatus.PENDING,
        },
        streamLimit
      )

      await requestRepository.createRequests(requests)

      const originaUpdateRequest = requestRepository.updateRequests
      requestRepository.updateRequests = (fields, requests, manager) => {
        throw new Error('test error')
      }

      try {
        await expect(requestRepository.findAndMarkReady(streamLimit)).rejects.toThrow(/test error/)
        const requestsAfterUpdate = await getAllRequests(connection)
        expect(requestsAfterUpdate.length).toEqual(requests.length)
        expect(requestsAfterUpdate.every(({ status }) => status === RequestStatus.PENDING)).toEqual(
          true
        )
      } finally {
        requestRepository.updateRequests = originaUpdateRequest
      }
    })

    test('Marks failed requests as ready', async () => {
      const streamLimit = 5
      const dateDuringRetryPeriod = new Date(Date.now() - FAILURE_RETRY_WINDOW + MS_IN_HOUR)
      const requests = await Promise.all([
        generateRequests(
          {
            status: RequestStatus.FAILED,
            createdAt: dateDuringRetryPeriod,
            updatedAt: new Date(Date.now() - MS_IN_HOUR),
            message: 'random',
          },
          1
        ),
        generateRequests(
          {
            status: RequestStatus.FAILED,
            createdAt: dateDuringRetryPeriod,
            updatedAt: new Date(Date.now() - MS_IN_HOUR),
          },
          streamLimit - 1
        ),
      ]).then((arr) => arr.flat())

      await requestRepository.createRequests(requests)

      const createdRequests = await getAllRequests(connection)
      expect(createdRequests.length).toEqual(requests.length)

      const updatedRequests = await requestRepository.findAndMarkReady(streamLimit)
      expect(updatedRequests.length).toEqual(streamLimit)

      expect(updatedRequests.map(({ cid }) => cid)).toEqual(createdRequests.map(({ cid }) => cid))
    })

    test('Will not mark expired failed requests as ready', async () => {
      const streamLimit = 5
      const dateBeforeRetryPeriod = new Date(Date.now() - FAILURE_RETRY_WINDOW - MS_IN_HOUR)

      const requests = await generateRequests(
        {
          status: RequestStatus.FAILED,
          createdAt: dateBeforeRetryPeriod,
          updatedAt: new Date(Date.now() - MS_IN_HOUR),
        },
        streamLimit
      )

      await requestRepository.createRequests(requests)

      const createdRequests = await getAllRequests(connection)
      expect(requests.length).toEqual(createdRequests.length)

      const updatedRequests = await requestRepository.findAndMarkReady(streamLimit)
      expect(updatedRequests.length).toEqual(0)
    })

    test('Will not mark failed requests that were rejected because of conflict resolution as ready', async () => {
      const streamLimit = 5
      const dateDuringRetryPeriod = new Date(Date.now() - FAILURE_RETRY_WINDOW + MS_IN_HOUR)

      const requests = await generateRequests(
        {
          status: RequestStatus.FAILED,
          createdAt: dateDuringRetryPeriod,
          updatedAt: new Date(Date.now() - MS_IN_HOUR),
          message: REQUEST_MESSAGES.conflictResolutionRejection,
        },
        streamLimit
      )

      await requestRepository.createRequests(requests)

      const createdRequests = await getAllRequests(connection)
      expect(requests.length).toEqual(createdRequests.length)

      const updatedRequests = await requestRepository.findAndMarkReady(streamLimit)
      expect(updatedRequests.length).toEqual(0)
    })
  })

  describe('transaction mutex', () => {
    test('Can successfully acquire transaction mutex', async () => {
      await requestRepository.withTransactionMutex(async () => {
        await Utils.delay(1000)
      })
    })

    test('Will block until can acquire transaction mutex', async () => {
      const childContainer = container.createChildContainer()
      childContainer.registerInstance('dbConnection', connection2)
      childContainer.registerSingleton('requestRepository', RequestRepository)
      const requestRepository2 = childContainer.resolve<RequestRepository>('requestRepository')

      await requestRepository.withTransactionMutex(async () => {
        await expect(
          requestRepository2.withTransactionMutex(() => Utils.delay(1000), 2, 1000)
        ).rejects.toThrow(/Failed to acquire transaction mutex/)
      })

      await requestRepository2.withTransactionMutex(() => Utils.delay(1000))
    })

    test('Will unlock the transaction mutex if the operation fails', async () => {
      await expect(
        requestRepository.withTransactionMutex(async () => {
          throw new Error('test error')
        })
      ).rejects.toThrow(/test error/)

      await requestRepository.withTransactionMutex(() => Utils.delay(1000))
    })
  })
})
