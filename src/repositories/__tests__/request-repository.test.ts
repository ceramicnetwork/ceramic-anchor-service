import 'reflect-metadata'
import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import type { Knex } from 'knex'
import { clearTables, createDbConnection } from '../../db-connection.js'
import { config } from 'node-config-ts'
import { PROCESSING_TIMEOUT, RequestRepository } from '../request-repository.js'
import { AnchorRepository } from '../anchor-repository.js'
import { Request, RequestStatus } from '../../models/request.js'
import {
  generateRequest,
  generateRequests,
  randomCID,
  randomStreamID,
  times,
} from '../../__tests__/test-utils.js'
import { createInjector } from 'typed-inject'
import { DateTime } from 'luxon'
import { StreamID } from '@ceramicnetwork/streamid'
import { asDIDString } from '@ceramicnetwork/codecs'
import { expectPresent } from '../../__tests__/expect-present.util.js'

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
      .provideFactory('requestRepository', RequestRepository.make)
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

  test('create: simultaneous creates will only create one request', async () => {
    const request = generateRequest({
      status: RequestStatus.READY,
    })

    const [result1, result2] = await Promise.all([
      requestRepository.create(request),
      requestRepository.create(request),
    ])
    expect(
      (result1 === null && result2?.cid === request.cid) ||
        (result2 === null && result1?.cid === request.cid)
    ).toBeTruthy()
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
      expectPresent(expiredRequests[0])
      expectPresent(requests[3])
      expect(expiredRequests[0].cid).toEqual(requests[3].cid)
      expectPresent(expiredRequests[1])
      expectPresent(requests[1])
      expect(expiredRequests[1].cid).toEqual(requests[1].cid)
    })

    test("Don't cleanup streams who have both old and new requests", async () => {
      // Create two requests that are expired and should be garbage collected, and two that should not
      // be.
      const requests: [Request, Request, Request, Request] = [
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
      expectPresent(expiredRequests[0])
      expect(expiredRequests[0].cid).toEqual(requests[1].cid)
    })
  })

  test('findAndMarkAsProcessing: process requests oldest to newest', async () => {
    const requests = generateReadyRequests(2)
    expectPresent(requests[0])
    expectPresent(requests[1])
    await requestRepository.createRequests(requests)
    const loadedRequests = await requestRepository.findAndMarkAsProcessing()

    expect(loadedRequests.length).toEqual(2)
    expectPresent(loadedRequests[0])
    expectPresent(loadedRequests[1])
    expect(loadedRequests[0].createdAt.getTime()).toBeLessThan(
      loadedRequests[1].createdAt.getTime()
    )
    expect(loadedRequests[0].cid).toEqual(requests[0].cid)
    expect(loadedRequests[1].cid).toEqual(requests[1].cid)
  })

  describe('findByStatus', () => {
    test('retrieve all requests of a specified status', async () => {
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

      const createdRequests = await requestRepository.allRequests()
      expect(requests.length).toEqual(createdRequests.length)

      const expected = createdRequests.filter(({ status }) => status === RequestStatus.READY)
      const received = await requestRepository.findByStatus(RequestStatus.READY)

      expect(received).toEqual(expected)
    })
  })

  describe('countByStatus', () => {
    test('return number of requests of a specified status', async () => {
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
      await expect(requestRepository.countByStatus(RequestStatus.READY)).resolves.toEqual(3)
      await expect(requestRepository.countByStatus(RequestStatus.PENDING)).resolves.toEqual(3)
      await expect(requestRepository.countByStatus(RequestStatus.COMPLETED)).resolves.toEqual(0)
    })
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

      const createdRequests = await requestRepository.allRequests()
      expect(requests.length).toEqual(createdRequests.length)

      const pendingRequests = createdRequests.filter((r) => r.status === RequestStatus.PENDING)
      const updatedRequests = await requestRepository.findAndMarkReady(streamLimit)
      expect(updatedRequests.length).toEqual(streamLimit)

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
      const createdRequests = await requestRepository.allRequests()
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

      const createdRequests = await requestRepository.allRequests()
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

      const expiredProcessing = generateRequest(
        // processing request that needs to be retried
        {
          status: RequestStatus.PROCESSING,
          createdAt: new Date(Date.now() - MS_IN_HOUR * 24),
          updatedAt: dateOfTimedOutProcessingRequest,
        }
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

      const createdRequests = await requestRepository.allRequests()
      expect(createdRequests.length).toEqual(requests.length)
      const updatedRequests = await requestRepository.findAndMarkReady(streamLimit)
      expect(updatedRequests.length).toEqual(streamLimit)

      // get earliest 4 pending as the expired processing request should be the first one
      const earliestPendingRequestCids = createdRequests
        .filter(({ status }) => status === RequestStatus.PENDING)
        .slice(0, streamLimit - 1)
        .map(({ cid }) => cid)

      expect(updatedRequests.map(({ cid }) => cid)).toEqual([
        expiredProcessing.cid,
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
      expectPresent(repeatedRequest1)
      const repeatedRequest2 = requests[1]
      expectPresent(repeatedRequest2)

      await requestRepository.createRequests(requests)

      const createdRequests = await requestRepository.allRequests()
      expect(createdRequests.length).toEqual(requests.length)
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

      const createdRequests = await requestRepository.allRequests()
      expect(createdRequests.length).toEqual(requests.length)
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

      const withConnectionSpy = jest.spyOn(requestRepository, 'withConnection')
      withConnectionSpy.mockImplementationOnce(() => requestRepository)

      const originalUpdateRequest = requestRepository.updateRequests
      requestRepository.updateRequests = () => {
        throw new Error('test error')
      }

      try {
        await expect(requestRepository.findAndMarkReady(streamLimit)).rejects.toThrow(/test error/)
        const requestsAfterUpdate = await requestRepository.allRequests()
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

      const createdRequests = await requestRepository.allRequests()
      expect(requests.length).toEqual(createdRequests.length)

      const retriedReadyRequestsCount = await requestRepository.updateExpiringReadyRequests()
      expect(retriedReadyRequestsCount).toEqual(expiredReadyRequestsCount)

      const allReadyRequests = await requestRepository.allRequests()
      expect(allReadyRequests.every(({ updatedAt }) => updatedAt > updatedTooLongAgo)).toEqual(true)
    })

    test('Does not update any expired ready requests if there are none', async () => {
      // ready requests created now
      const requests = generateRequests({})

      await requestRepository.createRequests(requests)

      const createdRequests = await requestRepository.allRequests()
      expect(requests.length).toEqual(createdRequests.length)

      const retriedReadyRequestsCount = await requestRepository.updateExpiringReadyRequests()
      expect(retriedReadyRequestsCount).toEqual(0)
    })
  })

  describe('markPreviousReplaced', () => {
    const ONE_HOUR_AGO = DateTime.fromISO('2023-01-01T00:00Z')

    test('mark older PENDING entries REPLACED', async () => {
      const streamId = randomStreamID()

      // Create three COMPLETED requests. These should not be changed
      const completedRequests = await requestRepository.createRequests(
        times(3).map((n) => {
          return new Request({
            cid: randomCID().toString(),
            streamId: streamId.toString(),
            timestamp: ONE_HOUR_AGO.minus({ minute: n }).toJSDate(),
            status: RequestStatus.COMPLETED,
            origin: 'same-origin',
          })
        })
      )

      // PENDING but with a different streamId
      const [unrelatedStreamRequest] = await requestRepository.createRequests([
        new Request({
          cid: randomCID().toString(),
          streamId: randomStreamID().toString(),
          timestamp: ONE_HOUR_AGO.toJSDate(),
          status: RequestStatus.PENDING,
          origin: 'same-origin',
        }),
      ])

      // Create three PENDING requests at `oneHourAgo` plus some minutes
      const requestsP = await requestRepository.createRequests(
        times(3).map((n) => {
          return new Request({
            cid: randomCID().toString(),
            streamId: streamId.toString(),
            timestamp: ONE_HOUR_AGO.plus({ minute: n }).toJSDate(),
            status: RequestStatus.PENDING,
            origin: 'same-origin',
          })
        })
      )
      const requests = await Promise.all(requestsP)
      const last = requests[requests.length - 1]
      expectPresent(last)
      // First two requests should be marked REPLACED
      const rowsAffected = await requestRepository.markReplaced(last)
      expect(rowsAffected).toEqual(2)
      const expectedAffected = requests.slice(0, rowsAffected)
      for (const r of expectedAffected) {
        const retrieved = await requestRepository.findByCid(r.cid)
        expectPresent(retrieved)
        expect(retrieved.status).toEqual(RequestStatus.REPLACED)
        expect(retrieved.message).toEqual(`Replaced by ${last.cid}`)
      }
      // Last request should be marked PENDING still
      const lastRetrieved = await requestRepository.findByCid(last.cid)
      expectPresent(lastRetrieved)
      expect(lastRetrieved.status).toEqual(RequestStatus.PENDING)

      // COMPLETED requests should not be affected
      for (const r of completedRequests) {
        const retrieved = await requestRepository.findByCid(r.cid)
        expect(retrieved).toEqual(r)
      }

      // Our unrelated request should not be affected
      const retrieved = await requestRepository.findByCid(unrelatedStreamRequest.cid)
      expect(retrieved).toEqual(unrelatedStreamRequest)
    })

    test('mark regardless of time', async () => {
      const streamId = randomStreamID()
      const requestsP = requestRepository.createRequests(
        times(3).map((n) => {
          return new Request({
            cid: randomCID().toString(),
            streamId: streamId.toString(),
            timestamp: ONE_HOUR_AGO.plus({ minute: n }).toJSDate(),
            status: RequestStatus.PENDING,
            origin: 'same-origin',
          })
        })
      )
      const requests: Array<Request> = await requestsP
      expectPresent(requests[0])
      const rowsAffected = await requestRepository.markReplaced(requests[0])
      expect(rowsAffected).toEqual(requests.length - 1) // Mark every request except the last one
      const all = await requestRepository.findByIds(requests.map((r) => r.id))
      const allById = new Map(
        all.map((r) => {
          return [r.id, r]
        })
      )
      expect(allById.get(requests[0].id)?.status).toEqual(RequestStatus.REPLACED)
      expectPresent(requests[1])
      expect(allById.get(requests[1].id)?.status).toEqual(RequestStatus.REPLACED)
      expectPresent(requests[2])
      expect(allById.get(requests[2].id)?.status).toEqual(RequestStatus.PENDING)
    })
  })

  describe('batchProcessing', () => {
    const MIN_LIMIT = 2
    const MAX_LIMIT = 3

    function createRequests(n: number): Promise<Request[]> {
      return requestRepository.createRequests(
        times(n).map(() => generateRequest({ status: RequestStatus.READY }))
      )
    }

    // TODO CDB-2231 Reconsider if it should be here or not
    test.skip('respect min limit', async () => {
      // Do not touch rows if we have less than MIN_LIMIT of them
      await createRequests(MIN_LIMIT - 1)
      const returned = await requestRepository.batchProcessing(MAX_LIMIT)
      expect(returned).toEqual([])
    })
    test('respect max limit', async () => {
      const requests = await createRequests(MAX_LIMIT * 2)
      const returned = await requestRepository.batchProcessing(MAX_LIMIT)
      expect(returned.length).toEqual(MAX_LIMIT)
      const requestsIds = requests.map((r) => r.id)
      expect(returned.every((r) => requestsIds.includes(r.id))).toBeTruthy()
      expect(returned.every((r) => r.status === RequestStatus.PROCESSING)).toBeTruthy()
    })
    test('update READY to PROCESSING', async () => {
      const requests = await createRequests(MAX_LIMIT)
      const returned = await requestRepository.batchProcessing(MAX_LIMIT)
      expect(returned.length).toEqual(MAX_LIMIT)
      expect(returned.map((r) => r.id).sort()).toEqual(requests.map((r) => r.id).sort())
      expect(returned.every((r) => r.status === RequestStatus.PROCESSING)).toBeTruthy()
    })
    // FIXME
    test.todo('respect request age')
  })

  describe('findByIds', () => {
    test('Retrieve all requests with given ids ', async () => {
      const requests = [
        generateRequests(
          {
            status: RequestStatus.READY,
          },
          2
        ),
        generateRequests(
          {
            status: RequestStatus.PENDING,
          },
          2
        ),
        generateRequests(
          {
            status: RequestStatus.PROCESSING,
          },
          2
        ),
        generateRequests(
          {
            status: RequestStatus.COMPLETED,
          },
          2
        ),
        generateRequests(
          {
            status: RequestStatus.FAILED,
          },
          2
        ),
      ].flat()

      await requestRepository.createRequests(requests)

      const createdRequests = await requestRepository.allRequests()
      expect(requests.length).toEqual(createdRequests.length)

      const received = await requestRepository.findByIds(requests.map(({ id }) => id))

      expect(received).toEqual(createdRequests)
    })
  })

  describe('findCompletedForStream', () => {
    test('Retrieve completed request for a given stream ', async () => {
      const myStreamId = randomStreamID().toString()
      const expectedRequest = await generateRequests(
        {
          streamId: myStreamId,
          status: RequestStatus.COMPLETED,
        },
        1
      )
      const requests = [
        generateRequests(
          {
            status: RequestStatus.READY,
          },
          2
        ),
        generateRequests(
          {
            status: RequestStatus.PENDING,
          },
          2
        ),
        generateRequests(
          {
            streamId: myStreamId,
            status: RequestStatus.PROCESSING,
          },
          2
        ),
        expectedRequest,
        generateRequests(
          {
            streamId: myStreamId,
            status: RequestStatus.COMPLETED,
            updatedAt: new Date(Date.now() - MS_IN_MONTH),
          },
          1
        ),
        generateRequests(
          {
            status: RequestStatus.FAILED,
          },
          2
        ),
      ].flat()

      await requestRepository.createRequests(requests)

      const createdRequests = await requestRepository.allRequests()
      expect(requests.length).toEqual(createdRequests.length)

      const received = await requestRepository.findCompletedForStream(myStreamId)
      expect(expectedRequest.map(({ id }) => id)).toEqual(received.map(({ id }) => id))
    })

    test('If the completed request for a given stream is too old, return an empty array', async () => {
      const myStreamId = randomStreamID().toString()
      const after = new Date(Date.now() - 1000 * 60 * 60)
      const requests = generateRequests(
        {
          streamId: myStreamId,
          status: RequestStatus.COMPLETED,
          updatedAt: new Date(after.getTime() - 1),
        },
        1
      )

      await requestRepository.createRequests(requests)

      const createdRequests = await requestRepository.allRequests()
      expect(requests.length).toEqual(createdRequests.length)

      const received = await requestRepository.findCompletedForStream(myStreamId, 1, after)
      expect(received.length).toEqual(0)
    })

    test('If there is no completed request for a given stream, return an empty array', async () => {
      const myStreamId = randomStreamID().toString()
      const requests = [
        generateRequests(
          {
            status: RequestStatus.COMPLETED,
          },
          2
        ),
        generateRequests(
          {
            status: RequestStatus.FAILED,
          },
          2
        ),
      ].flat()

      await requestRepository.createRequests(requests)

      const createdRequests = await requestRepository.allRequests()
      expect(requests.length).toEqual(createdRequests.length)

      const received = await requestRepository.findCompletedForStream(myStreamId)
      expect(received.length).toEqual(0)
    })
  })
})
