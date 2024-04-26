import 'reflect-metadata'
import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'

import { Request, RequestStatus } from '../../models/request.js'
import { AnchorService } from '../anchor-service.js'

import { clearTables, createDbConnection } from '../../db-connection.js'

import { RequestRepository } from '../../repositories/request-repository.js'
import type { IIpfsService } from '../ipfs-service.type.js'
import { AnchorRepository } from '../../repositories/anchor-repository.js'
import { config, Config } from 'node-config-ts'
import { StreamID } from '@ceramicnetwork/streamid'
import {
  generateRequests,
  MockIpfsService,
  repeat,
  MockQueueService,
  MockQueueMessage,
} from '../../__tests__/test-utils.js'
import type { Knex } from 'knex'
import { CID } from 'multiformats/cid'
import type { FreshAnchor } from '../../models/anchor.js'
import { toCID } from '@ceramicnetwork/common'
import { Utils } from '../../utils.js'
import { v4 as uuidv4, validate as validateUUID } from 'uuid'
import { TransactionRepository } from '../../repositories/transaction-repository.js'
import { Transaction } from '../../models/transaction.js'
import { createInjector, Injector } from 'typed-inject'
import { MetadataRepository } from '../../repositories/metadata-repository.js'
import { IMetadataService, MetadataService } from '../metadata-service.js'
import { asDIDString } from '@ceramicnetwork/codecs'
import { expectPresent } from '../../__tests__/expect-present.util.js'
import { AnchorBatchQMessage } from '../../models/queue-message.js'
import { Candidate } from '../candidate.js'
import { FakeFactory } from './fake-factory.util.js'
import { FakeEthereumBlockchainService } from './fake-ethereum-blockchain-service.util.js'
import { MockEventProducerService } from './mock-event-producer-service.util.js'
import { type IMerkleCarService, makeMerkleCarService } from '../merkle-car-service.js'

process.env['NODE_ENV'] = 'test'
process.env['CAS_USE_IPFS_STORAGE'] = 'true';

async function anchorCandidates(
  candidates: Candidate[],
  anchorService: AnchorService,
  ipfsService: IIpfsService
): Promise<FreshAnchor[]> {
  const merkleTree = await anchorService._buildMerkleTree(candidates)
  const ipfsProofCid = await ipfsService.storeRecord({})

  const anchors = await anchorService._createAnchorCommits(ipfsProofCid, merkleTree)

  await anchorService._persistAnchorResult(anchors, candidates)
  return anchors
}

const MERKLE_DEPTH_LIMIT = 3
const READY_RETRY_INTERVAL_MS = 1000
const STREAM_LIMIT = Math.pow(2, MERKLE_DEPTH_LIMIT)
const MIN_STREAM_COUNT = Math.floor(STREAM_LIMIT / 2)

type Context = {
  config: Config
  ipfsService: IIpfsService
  eventProducerService: MockEventProducerService
  requestRepository: RequestRepository
  anchorService: AnchorService
  metadataService: IMetadataService
  metadataRepository: MetadataRepository
  merkleCarService: IMerkleCarService
  anchorBatchQueueService: MockQueueService<any>
  blockchainService: FakeEthereumBlockchainService
}

describe('anchor service', () => {
  jest.setTimeout(10000)
  let ipfsService: IIpfsService
  let metadataService: IMetadataService
  let connection: Knex
  let injector: Injector<Context>
  let requestRepository: RequestRepository
  let anchorService: AnchorService
  let eventProducerService: MockEventProducerService
  let metadataRepository: MetadataRepository
  let merkleCarService: IMerkleCarService
  let fake: FakeFactory

  beforeAll(async () => {
    connection = await createDbConnection()
    injector = createInjector()
      .provideValue('dbConnection', connection)
      .provideValue(
        'config',
        Object.assign({}, config, {
          merkleDepthLimit: MERKLE_DEPTH_LIMIT,
          minStreamCount: MIN_STREAM_COUNT,
          readyRetryIntervalMS: READY_RETRY_INTERVAL_MS,
          carStorage: {
            mode: 'inmemory',
          },
          queue: {
            type: 'sqs',
            awsRegion: 'test',
            sqsQueueUrl: '',
            maxTimeToHoldMessageSec: 10,
            waitTimeForMessageSec: 5,
          },
        })
      )
      .provideClass('anchorRepository', AnchorRepository)
      .provideClass('metadataRepository', MetadataRepository)
      .provideFactory('requestRepository', RequestRepository.make)
      .provideClass('transactionRepository', TransactionRepository)
      .provideClass('blockchainService', FakeEthereumBlockchainService)
      .provideClass('ipfsService', MockIpfsService)
      .provideClass('eventProducerService', MockEventProducerService)
      .provideClass('metadataService', MetadataService)
      .provideClass('anchorBatchQueueService', MockQueueService<AnchorBatchQMessage>)
      .provideFactory('merkleCarService', makeMerkleCarService)
      .provideClass('anchorService', AnchorService)

    ipfsService = injector.resolve('ipfsService')
    await ipfsService.init()
    requestRepository = injector.resolve('requestRepository')
    anchorService = injector.resolve('anchorService')
    eventProducerService = injector.resolve('eventProducerService')
    metadataService = injector.resolve('metadataService')
    metadataRepository = injector.resolve('metadataRepository')
    merkleCarService = injector.resolve('merkleCarService')
    fake = new FakeFactory(ipfsService, metadataService, requestRepository)
  })

  beforeEach(async () => {
    await clearTables(connection)
    jest.restoreAllMocks()
    await requestRepository.table.delete()
  })

  afterAll(async () => {
    await connection.destroy()
  })

  test('check state on tx fail', async () => {
    const requests = await fake.multipleRequests(MIN_STREAM_COUNT, RequestStatus.READY)

    await expect(anchorService.anchorRequests()).rejects.toEqual(
      new Error('Failed to send transaction!')
    )

    for (const req of requests) {
      const retrievedRequest = await requestRepository.findByCid(CID.parse(req.cid))
      expect(retrievedRequest).toHaveProperty('status', RequestStatus.PENDING) // FIXME Should be READY again??
    }
  })

  test('Too few anchor requests', async () => {
    const numRequests = MIN_STREAM_COUNT - 1
    // Create pending requests
    await fake.multipleRequests(numRequests)

    const beforePending = await requestRepository.countByStatus(RequestStatus.PENDING)
    expect(beforePending).toEqual(numRequests)

    // Should not anchor requests as there aren't at least minStreamCount requests
    await anchorService.anchorRequests()
    const afterPending = await requestRepository.countByStatus(RequestStatus.PENDING)
    expect(afterPending).toEqual(numRequests)
  })

  test('create anchor records', async () => {
    const requests = await fake.multipleRequests(4, RequestStatus.PENDING)

    await requestRepository.findAndMarkReady(0)

    const [candidates] = await anchorService._findCandidates(requests, 0)
    const merkleTree = await anchorService._buildMerkleTree(candidates)
    const ipfsProofCid = await ipfsService.storeRecord({})

    const anchors = await anchorService._createAnchorCommits(ipfsProofCid, merkleTree)

    expect(candidates.length).toEqual(requests.length)
    expect(anchors.length).toEqual(candidates.length)

    // All requests are anchored, in a different order because of IpfsLeafCompare
    expect(anchors.map((a) => a.requestId).sort()).toEqual(requests.map((r) => r.id).sort())
    for (const [index, anchor] of anchors.entries()) {
      expectPresent(anchor)
      expect(anchor.proofCid.toString()).toEqual(ipfsProofCid.toString())
      const request = requests.find((r) => r.id === anchor.requestId)
      expectPresent(request)
      expect(anchor.requestId).toEqual(request.id)

      const anchorRecord = await ipfsService.retrieveRecord(anchor.cid)
      expect(anchorRecord.prev.toString()).toEqual(request.cid)
      expect(anchorRecord.proof).toEqual(ipfsProofCid)
      expect(anchorRecord.path).toEqual(anchor.path)
    }

    expectPresent(anchors[0])
    expect(anchors[0].path).toEqual('0/0')
    expectPresent(anchors[1])
    expect(anchors[1].path).toEqual('0/1')
    expectPresent(anchors[2])
    expect(anchors[2].path).toEqual('1/0')
    expectPresent(anchors[3])
    expect(anchors[3].path).toEqual('1/1')
  })

  test('Too many anchor requests', async () => {
    const anchorLimit = 4
    const numRequests = anchorLimit * 2 // twice as many requests as can fit

    // Create pending requests
    await fake.multipleRequests(numRequests)

    await requestRepository.findAndMarkReady(0)

    // First pass anchors half the pending requests
    let requests = await requestRepository.batchProcessing(anchorLimit)
    expect(requests.length).toEqual(anchorLimit)

    const anchorPendingRequests = async function (requests: Request[]): Promise<void> {
      const [candidates] = await anchorService._findCandidates(requests, anchorLimit)
      expect(candidates.length).toEqual(anchorLimit)

      await anchorCandidates(candidates, anchorService, ipfsService)
    }
    await anchorPendingRequests(requests)

    await requestRepository.findAndMarkReady(0)

    requests = await requestRepository.findByStatus(RequestStatus.READY)
    expect(requests.length).toEqual(numRequests / 2)

    // Second pass anchors the remaining half of the original requests
    await anchorPendingRequests(requests)

    // All requests should have been processed
    const leftOverRequests = await requestRepository.findAndMarkReady(0)
    expect(leftOverRequests.length).toEqual(0)
  })

  test('Anchors in request order', async () => {
    const anchorLimit = 4
    const numStreams = anchorLimit * 2 // twice as many streams as can fit in a batch

    // Create pending requests
    // We want 2 requests per streamId, but don't want the requests on the same stream to be created
    // back-to-back.  So we do one pass to generate the first request for each stream, then another
    // to make the second requests.
    const requests: Request[] = []
    const numFailed = Math.floor(anchorLimit / 2)
    let failedIndex = numFailed
    for (let i = 0; i < numStreams; i++) {
      const status = failedIndex > 0 ? RequestStatus.FAILED : RequestStatus.PENDING
      const request = await fake.request(status)
      failedIndex -= 1
      requests.push(request)

      // Make sure each stream gets a unique 'createdAt' Date
      await Utils.delay(100)
    }

    // Second pass, a second request per stream.  Create the 2nd request per stream in the opposite
    // order from how the first request per stream was.
    for (let i = numStreams - 1; i >= 0; i--) {
      const prevRequest = requests[i]
      expectPresent(prevRequest)
      const streamId = StreamID.fromString(prevRequest.streamId)

      const request = await fake.request(RequestStatus.PENDING, streamId)
      requests.push(request)

      // Make sure each stream gets a unique 'createdAt' Date
      await Utils.delay(100)
    }

    await expect(requestRepository.countByStatus(RequestStatus.READY)).resolves.toEqual(0)
    await requestRepository.findAndMarkReady(anchorLimit, 0)

    // First pass anchors half the pending requests
    await expect(requestRepository.countByStatus(RequestStatus.READY)).resolves.toEqual(anchorLimit)
    const pendingRequests = await requestRepository.batchProcessing(anchorLimit)
    expect(pendingRequests.length).toEqual(anchorLimit)
    const [candidates] = await anchorService._findCandidates(pendingRequests, anchorLimit)
    expect(candidates.length).toEqual(anchorLimit)

    await anchorCandidates(candidates, anchorService, ipfsService)
    await requestRepository.findAndMarkReady(anchorLimit)

    const remainingRequests = await requestRepository.findByStatus(RequestStatus.READY)
    const storedRequests = await requestRepository.allRequests()

    // Make sure that `requests` and `storedRequests` contain _same_ Requests at different stages of their lifecycle.
    // `requests` contain "vanilla" just created entries. `storedRequests` contains entries after a round of anchoring,
    // and few of them are marked as REPLACED, to imitate how CAS requests are created.

    // Make sure these are the same records in the same order
    expect(requests.map((r) => r.id)).toEqual(storedRequests.map((r) => r.id))

    // `requests`: FAILED, FAILED, PENDING, PENDING,..., PENDING
    expect(requests.map((r) => r.status)).toEqual(
      repeat(numFailed, RequestStatus.FAILED).concat(
        repeat(numStreams * 2 - numFailed, RequestStatus.PENDING)
      )
    )

    // After a round of anchors we should have some COMPLETED and some REPLACED
    // `storedRequests`: 2x FAILED, `numStreams - numFailed`x REPLACED, `anchorLimit` x COMPLETED, and the rest is READY.
    expect(storedRequests.map((r) => r.status)).toEqual(
      repeat(numFailed, RequestStatus.FAILED)
        .concat(repeat(numStreams - numFailed, RequestStatus.REPLACED))
        .concat(repeat(anchorLimit, RequestStatus.COMPLETED))
        .concat(repeat(requests.length - numStreams - anchorLimit, RequestStatus.READY))
    )

    // `remainingRecords` represent the last four entries, which are in READY state
    expect(remainingRequests.every((r) => r.status === RequestStatus.READY)).toBeTruthy()
    expect(remainingRequests.map((r) => r.id).sort()).toEqual(
      requests
        .slice(-anchorLimit)
        .map((r) => r.id)
        .sort()
    )
  }, 30000)

  test('Unlimited anchor requests', async () => {
    const anchorLimit = 0 // 0 means infinity
    const numRequests = 5

    // Create pending requests
    await fake.multipleRequests(numRequests)

    await requestRepository.findAndMarkReady(anchorLimit)

    const requests = await requestRepository.findByStatus(RequestStatus.READY)
    expect(requests.length).toEqual(numRequests)
    const [candidates] = await anchorService._findCandidates(requests, anchorLimit)
    expect(candidates.length).toEqual(numRequests)
    await anchorCandidates(candidates, anchorService, ipfsService)

    // All requests should have been processed
    const requestsReady = await requestRepository.countByStatus(RequestStatus.READY)
    expect(requestsReady).toEqual(0)
  })

  test('Does not create anchor commits if stream has already been anchored for those requests', async () => {
    const requestRepository = injector.resolve('requestRepository')
    const anchorService = injector.resolve('anchorService')

    const anchorLimit = 0 // 0 means infinity
    const numRequests = 5

    // Create pending requests
    await fake.multipleRequests(numRequests, RequestStatus.PENDING)

    await requestRepository.findAndMarkReady(anchorLimit)

    let requests = await requestRepository.findByStatus(RequestStatus.READY)
    expect(requests.length).toEqual(numRequests)
    const [candidates] = await anchorService._findCandidates(requests, anchorLimit)
    expect(candidates.length).toEqual(numRequests)
    await anchorCandidates(candidates, anchorService, ipfsService)

    requests = await requestRepository.findByStatus(RequestStatus.READY)
    expect(requests.length).toEqual(0)

    let anchors = await requestRepository.table
    expect(anchors.length).toEqual(numRequests)

    // re-anchor the same candidates
    await anchorCandidates(candidates, anchorService, ipfsService)

    // no new anchor should have been created
    anchors = await requestRepository.table
    expect(anchors.length).toEqual(numRequests)
  })

  describe('Request pinning', () => {
    async function anchorRequests(numRequests: number): Promise<Request[]> {
      // Create Requests
      const requests = await fake.multipleRequests(numRequests)
      const [candidates] = await anchorService._findCandidates(requests, 0)
      await anchorCandidates(candidates, anchorService, ipfsService)
      expect(candidates.length).toEqual(numRequests)

      return requests
    }

    test('Successful anchor pins request', async () => {
      const [request0] = await anchorRequests(1)
      expectPresent(request0)

      // Request should be marked as completed and pinned
      const updatedRequest0 = await requestRepository.findByCid(toCID(request0.cid))
      expectPresent(updatedRequest0)
      expect(updatedRequest0.status).toEqual(RequestStatus.COMPLETED)
      expect(updatedRequest0.cid).toEqual(request0.cid)
      expect(updatedRequest0.message).toEqual('CID successfully anchored.')
      expect(updatedRequest0.pinned).toEqual(true)
    })
  })

  describe('emitAnchorEventIfReady', () => {
    test('Does not emit if ready requests exist but they are not timed out', async () => {
      const originalRequests = [
        generateRequests(
          {
            status: RequestStatus.READY,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          2
        ),
        generateRequests(
          {
            status: RequestStatus.PENDING,
          },
          4
        ),
      ].flat()

      const withConnectionSpy = jest.spyOn(requestRepository, 'withConnection')
      withConnectionSpy.mockImplementationOnce(() => requestRepository)
      const requestRepositoryUpdateSpy = jest.spyOn(requestRepository, 'updateRequests')

      try {
        const emitSpy = jest.spyOn(eventProducerService, 'emitAnchorEvent')
        await requestRepository.createRequests(originalRequests)
        await anchorService.emitAnchorEventIfReady()

        expect(requestRepositoryUpdateSpy).toHaveBeenCalledTimes(0)
        expect(emitSpy).not.toBeCalled()
      } finally {
        requestRepositoryUpdateSpy.mockRestore()
      }
    })

    test('Emits an event if ready requests exist but they have timed out', async () => {
      const config = injector.resolve('config')
      const updatedTooLongAgo = new Date(Date.now() - config.readyRetryIntervalMS - 1000)
      // Ready requests that have timed out (created too long ago)
      const originalRequests = generateRequests(
        {
          status: RequestStatus.READY,
          createdAt: updatedTooLongAgo,
          updatedAt: updatedTooLongAgo,
        },
        3,
        0
      )

      const withConnectionSpy = jest.spyOn(requestRepository, 'withConnection')
      withConnectionSpy.mockImplementationOnce(() => requestRepository)
      const requestRepositoryUpdateSpy = jest.spyOn(requestRepository, 'updateRequests')

      await requestRepository.createRequests(originalRequests)

      const emitSpy = jest.spyOn(eventProducerService, 'emitAnchorEvent')
      await anchorService.emitAnchorEventIfReady()

      expect(requestRepositoryUpdateSpy).toHaveBeenCalledTimes(1)

      const updatedRequests = await requestRepository.findByStatus(RequestStatus.COMPLETED)

      expect(updatedRequests.every(({ updatedAt }) => updatedAt > updatedTooLongAgo)).toEqual(true)

      expect(emitSpy).toBeCalledTimes(1)
      expectPresent(emitSpy.mock.calls[0])
      expect(validateUUID(emitSpy.mock.calls[0][0])).toEqual(true)
      requestRepositoryUpdateSpy.mockRestore()
    })

    test('does not emit if no requests were updated to ready', async () => {
      // not enough requests generated
      const originalRequests = generateRequests(
        {
          status: RequestStatus.PENDING,
        },
        MIN_STREAM_COUNT - 1
      )
      await requestRepository.createRequests(originalRequests)
      const emitSpy = jest.spyOn(eventProducerService, 'emitAnchorEvent')
      await anchorService.emitAnchorEventIfReady()
      expect(emitSpy).not.toBeCalled()
    })

    test('emits if requests were updated to ready', async () => {
      const originalRequests = generateRequests(
        {
          status: RequestStatus.PENDING,
        },
        STREAM_LIMIT
      )

      await requestRepository.createRequests(originalRequests)
      for (const request of originalRequests) {
        await metadataRepository.save({
          streamId: StreamID.fromString(request.streamId),
          metadata: {
            controllers: [asDIDString(`did:random:${Math.random()}`)],
          },
        })
      }
      const emitSpy = jest.spyOn(eventProducerService, 'emitAnchorEvent')
      await anchorService.emitAnchorEventIfReady()

      expect(emitSpy.mock.calls.length).toEqual(1)
      expectPresent(emitSpy.mock.calls[0])
      expect(validateUUID(emitSpy.mock.calls[0][0])).toEqual(true)

      const updatedRequests = await requestRepository.findByStatus(RequestStatus.READY)
      expect(updatedRequests.map(({ cid }) => cid).sort()).toEqual(
        originalRequests.map(({ cid }) => cid).sort()
      )
    })

    test('Does not crash if the event producer rejects', async () => {
      const originalRequests = generateRequests(
        {
          status: RequestStatus.PENDING,
        },
        STREAM_LIMIT
      )

      for (const request of originalRequests) {
        await metadataRepository.save({
          streamId: StreamID.fromString(request.streamId),
          metadata: {
            controllers: ['did:foo'],
          },
        })
      }

      jest
        .spyOn(eventProducerService, 'emitAnchorEvent')
        .mockRejectedValueOnce(new Error(`test error`))

      await requestRepository.createRequests(originalRequests)
      await anchorService.emitAnchorEventIfReady()
    })

    test('Does not retry requests that are being updated simultaneously', async () => {
      const emitSpy = jest.spyOn(eventProducerService, 'emitAnchorEvent')
      const config = injector.resolve('config')
      const updatedTooLongAgo = new Date(Date.now() - config.readyRetryIntervalMS - 1000)

      // Ready requests that have timed out (created too long ago)
      const requests = generateRequests(
        {
          status: RequestStatus.READY,
          createdAt: updatedTooLongAgo,
          updatedAt: updatedTooLongAgo,
        },
        3,
        0
      )

      await requestRepository.createRequests(requests)
      const createdRequests = await requestRepository.findByStatus(RequestStatus.READY)

      await Promise.all([
        requestRepository.updateRequests(
          { status: RequestStatus.COMPLETED, message: 'request0' },
          createdRequests.slice(0, 1)
        ),
        requestRepository.updateRequests(
          { status: RequestStatus.PENDING, message: 'request1' },
          createdRequests.slice(1, 2)
        ),
        requestRepository.updateRequests(
          { status: RequestStatus.FAILED, message: 'request2' },
          createdRequests.slice(2)
        ),
        anchorService.emitAnchorEventIfReady(),
      ])

      const updatedRequestsCount = await requestRepository.countByStatus(RequestStatus.READY)
      expect(updatedRequestsCount).toEqual(0)
      expect(emitSpy).not.toBeCalled()
    })
  })

  describe('Anchoring Queued Batches', () => {
    let anchorBatchQueueService: MockQueueService<AnchorBatchQMessage>
    let blockchainService: FakeEthereumBlockchainService
    const fakeTransaction = new Transaction('test', 'hash', 1, 1)

    beforeAll(() => {
      //@ts-ignore
      anchorService.useQueueBatches = true

      anchorBatchQueueService = injector.resolve('anchorBatchQueueService')
      blockchainService = injector.resolve('blockchainService')
    })

    afterAll(() => {
      //@ts-ignore
      anchorService.useQueueBatches = false
      anchorBatchQueueService.reset()
    })

    test('Does not anchor anything if there is no batch', async () => {
      const numRequests = 4
      await fake.multipleRequests(numRequests)

      await anchorService.anchorRequests()

      const remainingRequests = await requestRepository.findByStatus(RequestStatus.PENDING)
      expect(remainingRequests.length).toEqual(numRequests)

      expect(anchorBatchQueueService.receiveMessage).toHaveReturnedWith(undefined)
    })

    test('Can successfuly anchor a batch and ack it', async () => {
      const numRequests = 4
      const requests = await fake.multipleRequests(numRequests)

      const batch = new MockQueueMessage({
        bid: uuidv4(),
        rids: requests.map(({ id }) => id),
      })
      anchorBatchQueueService.receiveMessage.mockReturnValue(Promise.resolve(batch))

      const original = blockchainService.sendTransaction
      blockchainService.sendTransaction = () => {
        return Promise.resolve(fakeTransaction)
      }

      try {
        const storeCarFileSpy = jest.spyOn(merkleCarService, 'storeCarFile')
        await anchorService.anchorRequests()
        expect(storeCarFileSpy).toBeCalled()

        const remainingRequests = await requestRepository.findByStatus(RequestStatus.PENDING)
        expect(remainingRequests.length).toEqual(0)

        const completedRequests = await requestRepository.findByStatus(RequestStatus.COMPLETED)
        expect(completedRequests.length).toEqual(numRequests)

        expect(batch.ack).toHaveBeenCalledTimes(1)
      } finally {
        blockchainService.sendTransaction = original
      }
    })

    test('Will nack the batch if the anchor failed', async () => {
      const numRequests = 4
      const requests = await fake.multipleRequests(numRequests)

      const batch = new MockQueueMessage({
        bid: uuidv4(),
        rids: requests.map(({ id }) => id),
      })
      anchorBatchQueueService.receiveMessage.mockReturnValue(Promise.resolve(batch))

      await expect(anchorService.anchorRequests()).rejects.toEqual(
        new Error('Failed to send transaction!')
      )

      const remainingRequests = await requestRepository.findByStatus(RequestStatus.PENDING)
      expect(remainingRequests.length).toEqual(numRequests)
      const completedRequests = await requestRepository.findByStatus(RequestStatus.COMPLETED)
      expect(completedRequests.length).toEqual(0)

      expect(batch.nack).toHaveBeenCalledTimes(1)
    })

    test('Ignores replaced requests when anchoring a batch', async () => {
      const numRequests = 4
      const requests = await Promise.all([
        fake.multipleRequests(numRequests / 2),
        fake.multipleRequests(numRequests / 2, RequestStatus.REPLACED),
      ]).then((x) => x.flat())

      const batch = new MockQueueMessage({
        bid: uuidv4(),
        rids: requests.map(({ id }) => id),
      })
      anchorBatchQueueService.receiveMessage.mockReturnValue(Promise.resolve(batch))

      const original = blockchainService.sendTransaction
      blockchainService.sendTransaction = () => {
        return Promise.resolve(fakeTransaction)
      }

      try {
        await anchorService.anchorRequests()

        const remainingRequests = await requestRepository.findByStatus(RequestStatus.PENDING)
        expect(remainingRequests.length).toEqual(0)

        const completedRequests = await requestRepository.findByStatus(RequestStatus.COMPLETED)
        expect(completedRequests.length).toEqual(numRequests / 2)

        const replacedRequests = await requestRepository.findByStatus(RequestStatus.REPLACED)
        expect(replacedRequests.length).toEqual(numRequests / 2)

        expect(batch.ack).toHaveBeenCalledTimes(1)
      } finally {
        blockchainService.sendTransaction = original
      }
    })

    test('fail a batch if can not import Merkle CAR to IPFS', async () => {
      const numRequests = 4
      const requests = await fake.multipleRequests(numRequests)

      const batch = new MockQueueMessage({
        bid: uuidv4(),
        rids: requests.map(({ id }) => id),
      })
      anchorBatchQueueService.receiveMessage.mockReturnValue(Promise.resolve(batch))

      const original = blockchainService.sendTransaction
      blockchainService.sendTransaction = () => {
        return Promise.resolve(fakeTransaction)
      }

      jest.spyOn(ipfsService, 'importCAR').mockImplementation(async () => {
        throw new Error(`Can not import merkle CAR`)
      })
      await expect(anchorService.anchorRequests()).rejects.toThrow()
      const retrieved = await requestRepository.findByIds(requests.map((r) => r.id))
      expect(retrieved.every((r) => r.status === RequestStatus.PENDING)).toBeTruthy()
      blockchainService.sendTransaction = original
    })

    test('fail a batch if can not store Merkle CAR to S3', async () => {
      const numRequests = 4
      const requests = await fake.multipleRequests(numRequests)

      const batch = new MockQueueMessage({
        bid: uuidv4(),
        rids: requests.map(({ id }) => id),
      })
      anchorBatchQueueService.receiveMessage.mockReturnValue(Promise.resolve(batch))

      const original = blockchainService.sendTransaction
      blockchainService.sendTransaction = () => {
        return Promise.resolve(fakeTransaction)
      }

      jest.spyOn(merkleCarService, 'storeCarFile').mockImplementation(async () => {
        throw new Error(`Can not store Merkle CAR to S3`)
      })
      await expect(anchorService.anchorRequests()).rejects.toThrow()
      const retrieved = await requestRepository.findByIds(requests.map((r) => r.id))
      expect(retrieved.every((r) => r.status === RequestStatus.PENDING)).toBeTruthy()
      blockchainService.sendTransaction = original
    })
  })
})
