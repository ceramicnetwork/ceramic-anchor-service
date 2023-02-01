import 'reflect-metadata'
import { jest } from '@jest/globals'
import type { Knex } from 'knex'
import { createDbConnection, clearTables } from '../../db-connection.js'
import { config } from 'node-config-ts'
import {
  RequestRepository,
  PROCESSING_TIMEOUT,
  FAILURE_RETRY_WINDOW,
  TABLE_NAME,
  FAILURE_RETRY_INTERVAL,
} from '../request-repository.js'
import { AnchorRepository } from '../anchor-repository.js'
import { Request, REQUEST_MESSAGES, RequestStatus } from '../../models/request.js'
import { generateRequests, generateRequest, randomStreamID } from '../../__tests__/test-utils.js'
import { createInjector } from 'typed-inject'

const MS_IN_MINUTE = 1000 * 60
const MS_IN_HOUR = MS_IN_MINUTE * 60
const MS_IN_DAY = MS_IN_HOUR * 24
const MS_IN_MONTH = MS_IN_DAY * 30

function generateCompletedRequest(expired: boolean, failed: boolean, varianceMS = 0): Request {
  const now = new Date()
  const threeMonthsAgo = new Date(now.getTime() - MS_IN_MONTH * 3 + varianceMS)
  const fiveDaysAgo = new Date(now.getTime() - MS_IN_DAY * 5 + varianceMS)
  const moreThanMonthAgo = new Date(now.getTime() - MS_IN_DAY * 31 + varianceMS)

  return generateRequest({
    status: failed ? RequestStatus.FAILED : RequestStatus.COMPLETED,
    message: 'cid anchored successfully',
    pinned: true,
    createdAt: threeMonthsAgo,
    updatedAt: expired ? moreThanMonthAgo : fiveDaysAgo,
  })
}

function generateReadyRequests(count: number): Array<Request> {
  return generateRequests({ status: RequestStatus.READY }, count, MS_IN_HOUR)
}

async function getAllRequests(connection: Knex): Promise<Array<Request>> {
  return connection.table(TABLE_NAME).orderBy('createdAt', 'asc')
}

describe('request repository test', () => {
  jest.setTimeout(10000)
  let connection: Knex
  let connection2: Knex
  let requestRepository: RequestRepository

  beforeAll(async () => {
    connection = await createDbConnection()
    connection2 = await createDbConnection()

    const c = createInjector()
      .provideValue('config', config)
      .provideValue('dbConnection', connection)
      .provideClass('requestRepository', RequestRepository)
      .provideClass('anchorRepository', AnchorRepository)

    requestRepository = c.resolve('requestRepository')
  })

  beforeEach(async () => {
    await clearTables(connection)
    await clearTables(connection2)
  })

  afterAll(async () => {
    await connection.destroy()
    await connection2.destroy()
  })

  test('createOrUpdate: can createOrUpdate simultaneously', async () => {
    const request = generateRequest({
      status: RequestStatus.READY,
    })

    const [result1, result2] = await Promise.all([
      requestRepository.createOrUpdate(request),
      requestRepository.createOrUpdate(request),
    ])
    expect(result1).toEqual(result2)
  })

  test('countPendingRequests', async () => {
    const requests = [
      generateRequest({
        status: RequestStatus.PENDING,
      }),
      generateRequest({
        status: RequestStatus.PROCESSING,
      }),
      generateRequest({
        status: RequestStatus.READY,
      }),
      generateRequest({
        status: RequestStatus.FAILED,
      }),
      generateRequest({
        status: RequestStatus.COMPLETED,
      }),
      generateRequest({
        status: RequestStatus.PENDING,
      }),
    ]
    await requestRepository.createRequests(requests)

    await expect(requestRepository.countPendingRequests()).resolves.toEqual(2)
  })

  describe('findRequestsToGarbageCollect', () => {
    test('Finds requests older than a month', async () => {
      // Create two requests that are expired and should be garbage collected, and two that should not
      // be.
      const requests = [
        generateCompletedRequest(false, false, 0),
        generateCompletedRequest(true, false, 100),
        generateCompletedRequest(false, true, 200),
        generateCompletedRequest(true, true, 300),
      ]

      await requestRepository.createRequests(requests)

      const expiredRequests = await requestRepository.findRequestsToGarbageCollect()
      expect(expiredRequests.length).toEqual(2)
      expect(expiredRequests[0].cid).toEqual(requests[3].cid)
      expect(expiredRequests[1].cid).toEqual(requests[1].cid)
    })

    test("Don't cleanup streams who have both old and new requests", async () => {
      // Create two requests that are expired and should be garbage collected, and two that should not
      // be.
      const requests = [
        generateCompletedRequest(false, false),
        generateCompletedRequest(true, false),
        generateCompletedRequest(false, true),
        generateCompletedRequest(true, true),
      ]

      // Set an expired and non-expired request to be on the same streamId. The expired request should
      // not show up to be garbage collected.
      requests[3].streamId = requests[2].streamId

      await requestRepository.createRequests(requests)

      const expiredRequests = await requestRepository.findRequestsToGarbageCollect()
      expect(expiredRequests.length).toEqual(1)
      expect(expiredRequests[0].cid).toEqual(requests[1].cid)
    })
  })

  test('findAndMarkAsProcessing: process requests oldest to newest', async () => {
    const requests = generateReadyRequests(2)
    await requestRepository.createRequests(requests)
    const loadedRequests = await requestRepository.findAndMarkAsProcessing()

    expect(loadedRequests.length).toEqual(2)
    expect(loadedRequests[0].createdAt.getTime()).toBeLessThan(
      loadedRequests[1].createdAt.getTime()
    )
    expect(loadedRequests[0].cid).toEqual(requests[0].cid)
    expect(loadedRequests[1].cid).toEqual(requests[1].cid)
  })

  test('findByStatus: retrieves all requests of a specified status', async () => {
    const requests = [
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
    ].flat()

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
      const requests = [
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
      ].flat()

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
      const requests = [
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
      ].flat()

      await requestRepository.createRequests(requests)

      const updatedRequests = await requestRepository.findAndMarkReady(streamLimit)
      expect(updatedRequests.length).toEqual(0)
    })

    test('Marks expired pending request as ready even if there are not enough streams', async () => {
      const streamLimit = 5
      // 13 hours ago (delay is 12 hours)
      const creationDateOfExpiredRequest = new Date(
        Date.now() - config.maxAnchoringDelayMS - MS_IN_HOUR
      )
      const requests = [
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
      ].flat()

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
      const requests = generateRequests({ status: RequestStatus.PENDING }, streamLimit + 2)

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

      const expiredProcessing = generateRequests(
        // processing request that needs to be retried
        {
          status: RequestStatus.PROCESSING,
          createdAt: new Date(Date.now() - MS_IN_HOUR * 24),
          updatedAt: dateOfTimedOutProcessingRequest,
        },
        1
      )
      const requests = [
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
      ].flat()

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
      const repeatedStreamId = randomStreamID().toString()
      const requests = [
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
      ].flat()
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
      const repeatedStreamId = randomStreamID().toString()

      const shouldBeIncluded = [
        // PENDING created now
        generateRequests(
          {
            status: RequestStatus.PENDING,
            streamId: repeatedStreamId,
          },
          1
        ),
        // TODO: https://linear.app/3boxlabs/issue/CDB-2221/turn-cas-failure-retry-back-on
        // // failed request
        // generateRequests(
        //   {
        //     status: RequestStatus.FAILED,
        //     streamId: repeatedStreamId,
        //     createdAt: new Date(Date.now() - FAILURE_RETRY_INTERVAL - MS_IN_HOUR),
        //     updatedAt: new Date(Date.now() - FAILURE_RETRY_INTERVAL - MS_IN_MINUTE * 30),
        //   },
        //   1
        // ),
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
      ].flat()

      const shouldNotBeIncluded = [
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
      ].flat()

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
      const requests = generateRequests(
        {
          status: RequestStatus.PENDING,
        },
        streamLimit
      )

      await requestRepository.createRequests(requests)

      const originalUpdateRequest = requestRepository.updateRequests
      requestRepository.updateRequests = () => {
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
        requestRepository.updateRequests = originalUpdateRequest
      }
    })

    // TODO: https://linear.app/3boxlabs/issue/CDB-2221/turn-cas-failure-retry-back-on

    // test('Marks failed requests as ready', async () => {
    //   const streamLimit = 5
    //   const dateDuringRetryPeriod = new Date(Date.now() - FAILURE_RETRY_WINDOW + MS_IN_HOUR)
    //   const requests = [
    //     generateRequests(
    //       {
    //         status: RequestStatus.FAILED,
    //         createdAt: new Date(dateDuringRetryPeriod.getTime() + MS_IN_MINUTE),
    //         updatedAt: new Date(Date.now() - FAILURE_RETRY_INTERVAL - MS_IN_HOUR),
    //         message: 'random',
    //       },
    //       1
    //     ),
    //     generateRequests(
    //       {
    //         status: RequestStatus.FAILED,
    //         createdAt: dateDuringRetryPeriod,
    //         updatedAt: new Date(Date.now() - FAILURE_RETRY_INTERVAL - MS_IN_HOUR),
    //       },
    //       streamLimit - 1
    //     ),
    //   ].flat()

    //   await requestRepository.createRequests(requests)

    //   const createdRequests = await getAllRequests(connection)
    //   expect(createdRequests.length).toEqual(requests.length)

    //   const updatedRequests = await requestRepository.findAndMarkReady(streamLimit)
    //   expect(updatedRequests.length).toEqual(streamLimit)

    //   expect(updatedRequests.map(({ cid }) => cid)).toEqual(createdRequests.map(({ cid }) => cid))
    // })

    // test('Will not mark expired failed requests as ready', async () => {
    //   const streamLimit = 5
    //   const dateBeforeRetryPeriod = new Date(Date.now() - FAILURE_RETRY_WINDOW - MS_IN_HOUR)

    //   const requests = generateRequests(
    //     {
    //       status: RequestStatus.FAILED,
    //       createdAt: dateBeforeRetryPeriod,
    //       updatedAt: new Date(Date.now() - FAILURE_RETRY_INTERVAL - MS_IN_HOUR),
    //     },
    //     streamLimit
    //   )

    //   await requestRepository.createRequests(requests)

    //   const createdRequests = await getAllRequests(connection)
    //   expect(requests.length).toEqual(createdRequests.length)

    //   const updatedRequests = await requestRepository.findAndMarkReady(streamLimit)
    //   expect(updatedRequests.length).toEqual(0)
    // })

    // test('Will not mark failed requests that were rejected because of conflict resolution as ready', async () => {
    //   const streamLimit = 5
    //   const dateDuringRetryPeriod = new Date(Date.now() - FAILURE_RETRY_WINDOW + MS_IN_HOUR)

    //   const requests = generateRequests(
    //     {
    //       status: RequestStatus.FAILED,
    //       createdAt: dateDuringRetryPeriod,
    //       updatedAt: new Date(Date.now() - FAILURE_RETRY_INTERVAL - MS_IN_HOUR),
    //       message: REQUEST_MESSAGES.conflictResolutionRejection,
    //     },
    //     streamLimit
    //   )

    //   await requestRepository.createRequests(requests)

    //   const createdRequests = await getAllRequests(connection)
    //   expect(requests.length).toEqual(createdRequests.length)

    //   const updatedRequests = await requestRepository.findAndMarkReady(streamLimit)
    //   expect(updatedRequests.length).toEqual(0)
    // })

    // test('Will not mark failed requests that were tried recently as ready', async () => {
    //   const streamLimit = 5
    //   const dateDuringRetryPeriod = new Date(Date.now() - FAILURE_RETRY_WINDOW + MS_IN_HOUR)

    //   const requests = generateRequests(
    //     {
    //       status: RequestStatus.FAILED,
    //       createdAt: dateDuringRetryPeriod,
    //       updatedAt: new Date(Date.now() - MS_IN_HOUR),
    //     },
    //     streamLimit
    //   )

    //   await requestRepository.createRequests(requests)

    //   const createdRequests = await getAllRequests(connection)
    //   expect(requests.length).toEqual(createdRequests.length)

    //   const updatedRequests = await requestRepository.findAndMarkReady(streamLimit)
    //   expect(updatedRequests.length).toEqual(0)
    // })
  })

  describe('updateExpiringReadyRequests', () => {
    test('Updates expiring ready requests if they exist', async () => {
      const updatedTooLongAgo = new Date(Date.now() - config.readyRetryIntervalMS - 1000)
      const expiredReadyRequestsCount = 3

      // expired ready request
      const requests = generateRequests(
        {
          status: RequestStatus.READY,
          createdAt: updatedTooLongAgo,
          updatedAt: updatedTooLongAgo,
        },
        expiredReadyRequestsCount,
        0
      )

      await requestRepository.createRequests(requests)

      const createdRequests = await getAllRequests(connection)
      expect(requests.length).toEqual(createdRequests.length)

      const retriedReadyRequestsCount = await requestRepository.updateExpiringReadyRequests()
      expect(retriedReadyRequestsCount).toEqual(expiredReadyRequestsCount)

      const allReadyRequests = await getAllRequests(connection)
      expect(allReadyRequests.every(({ updatedAt }) => updatedAt > updatedTooLongAgo)).toEqual(true)
    })

    test('Does not update any expired ready requests if there are none', async () => {
      // ready requests created now
      const requests = generateRequests({})

      await requestRepository.createRequests(requests)

      const createdRequests = await getAllRequests(connection)
      expect(requests.length).toEqual(createdRequests.length)

      const retriedReadyRequestsCount = await requestRepository.updateExpiringReadyRequests()
      expect(retriedReadyRequestsCount).toEqual(0)
    })
  })
})
