import 'reflect-metadata'
import { jest, describe, beforeAll, beforeEach, test, expect, afterAll } from '@jest/globals'

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
  MockIpfsClient,
  randomStreamID,
  repeat,
} from '../../__tests__/test-utils.js'
import type { Knex } from 'knex'
import { CID } from 'multiformats/cid'
import { Candidate } from '../../merkle/merkle-objects.js'
import { Anchor } from '../../models/anchor.js'
import { toCID } from '@ceramicnetwork/common'
import { Utils } from '../../utils.js'
import { PubsubMessage } from '@ceramicnetwork/core'
import { validate as validateUUID } from 'uuid'
import { TransactionRepository } from '../../repositories/transaction-repository.js'
import type { BlockchainService } from '../blockchain/blockchain-service'
import type { Transaction } from '../../models/transaction.js'
import { createInjector, Injector } from 'typed-inject'
import { MetadataRepository } from '../../repositories/metadata-repository.js'
import { randomString } from '@stablelib/random'
import { IMetadataService, MetadataService } from '../metadata-service.js'
import { asDIDString } from '../../ancillary/did-string.js'
import type { EventProducerService } from '../event-producer/event-producer-service.js'
import { expectPresent } from '../../__tests__/expect-present.util.js'

process.env['NODE_ENV'] = 'test'

export class MockEventProducerService implements EventProducerService {
  readonly emitAnchorEvent = jest.fn((_body: string) => Promise.resolve())
}

class FakeEthereumBlockchainService implements BlockchainService {
  chainId = 'impossible'

  connect(): Promise<void> {
    throw new Error(`Failed to connect`)
  }

  sendTransaction(): Promise<Transaction> {
    throw new Error('Failed to send transaction!')
  }
}

async function createRequest(
  streamId: string,
  ipfsService: IIpfsService,
  requestRepository: RequestRepository,
  status: RequestStatus = RequestStatus.PENDING
): Promise<Request> {
  const cid = await ipfsService.storeRecord({})
  const request = new Request()
  request.cid = cid.toString()
  request.streamId = streamId
  request.status = status
  request.message = 'Request is pending.'
  request.pinned = true

  const stored = await requestRepository.createOrUpdate(request)
  await requestRepository.markPreviousReplaced(stored)
  return stored
}

async function anchorCandidates(
  candidates: Candidate[],
  anchorService: AnchorService,
  ipfsService: IIpfsService
): Promise<Anchor[]> {
  const merkleTree = await anchorService._buildMerkleTree(candidates)
  const ipfsProofCid = await ipfsService.storeRecord({})

  const anchors = await anchorService._createAnchorCommits(ipfsProofCid, merkleTree)

  await anchorService._persistAnchorResult(anchors, candidates)
  return anchors
}

const mockIpfsClient = new MockIpfsClient()
jest.unstable_mockModule('ipfs-http-client', () => {
  const originalModule = jest.requireActual('ipfs-http-client') as any

  return {
    __esModule: true,
    ...originalModule,
    create: () => {
      return mockIpfsClient
    },
  }
})

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

  beforeAll(async () => {
    const { IpfsService } = await import('../ipfs-service.js')

    connection = await createDbConnection()
    injector = createInjector()
      .provideValue('dbConnection', connection)
      .provideValue(
        'config',
        Object.assign({}, config, {
          merkleDepthLimit: MERKLE_DEPTH_LIMIT,
          minStreamCount: MIN_STREAM_COUNT,
          readyRetryIntervalMS: READY_RETRY_INTERVAL_MS,
        })
      )
      .provideClass('anchorRepository', AnchorRepository)
      .provideClass('metadataRepository', MetadataRepository)
      .provideFactory('requestRepository', RequestRepository.make)
      .provideClass('transactionRepository', TransactionRepository)
      .provideClass('blockchainService', FakeEthereumBlockchainService)
      .provideClass('ipfsService', IpfsService)
      .provideClass('eventProducerService', MockEventProducerService)
      .provideClass('metadataService', MetadataService)
      .provideClass('anchorService', AnchorService)

    ipfsService = injector.resolve('ipfsService')
    await ipfsService.init()
    requestRepository = injector.resolve('requestRepository')
    anchorService = injector.resolve('anchorService')
    eventProducerService = injector.resolve('eventProducerService')
    metadataService = injector.resolve('metadataService')
    metadataRepository = injector.resolve('metadataRepository')
  })

  beforeEach(async () => {
    await clearTables(connection)
    mockIpfsClient.reset()
    eventProducerService.emitAnchorEvent.mockClear()
    await requestRepository.table.delete()
  })

  afterAll(async () => {
    await connection.destroy()
  })

  test('check state on tx fail', async () => {
    const requests: Request[] = []
    for (let i = 0; i < MIN_STREAM_COUNT; i++) {
      const genesisCID = await ipfsService.storeRecord({
        header: {
          controllers: [`did:method:${randomString(32)}`],
        },
      })
      const streamId = new StreamID(1, genesisCID)
      await metadataService.fillFromIpfs(streamId)
      const cid = await ipfsService.storeRecord({})

      const request = new Request()
      request.cid = cid.toString()
      request.streamId = streamId.toString()
      request.status = RequestStatus.READY
      request.message = 'Request is pending.'

      requests.push(request)
    }

    await requestRepository.createRequests(requests)

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
    for (let i = 0; i < numRequests; i++) {
      const streamId = await randomStreamID()
      await createRequest(streamId.toString(), ipfsService, requestRepository)
    }

    const beforePending = await requestRepository.countByStatus(RequestStatus.PENDING)
    expect(beforePending).toEqual(numRequests)

    // Should not anchor requests as there aren't at least minStreamCount requests
    await anchorService.anchorRequests()
    const afterPending = await requestRepository.countByStatus(RequestStatus.PENDING)
    expect(afterPending).toEqual(numRequests)
  })

  test('create anchor records', async () => {
    // Create pending requests
    const requests: Request[] = []
    const numRequests = 4
    for (let i = 0; i < numRequests; i++) {
      const genesisCID = await ipfsService.storeRecord({
        header: {
          controllers: [`did:method:${randomString(32)}`],
        },
      })
      const streamId = new StreamID(1, genesisCID)
      await metadataService.fillFromIpfs(streamId)
      const request = await createRequest(streamId.toString(), ipfsService, requestRepository)
      requests.push(request)
    }
    requests.sort(function (a, b) {
      return a.streamId.localeCompare(b.streamId)
    })

    await requestRepository.findAndMarkReady(0)

    const [candidates] = await anchorService._findCandidates(requests, 0)
    const merkleTree = await anchorService._buildMerkleTree(candidates)
    const ipfsProofCid = await ipfsService.storeRecord({})

    const anchors = await anchorService._createAnchorCommits(ipfsProofCid, merkleTree)

    expect(candidates.length).toEqual(requests.length)
    expect(anchors.length).toEqual(candidates.length)

    expect(mockIpfsClient.pubsub.publish.mock.calls.length).toEqual(anchors.length)
    const config = injector.resolve('config')

    // All requests are anchored, in a different order because of IpfsLeafCompare
    expect(anchors.map((a) => a.requestId).sort()).toEqual(requests.map((r) => r.id).sort())
    for (const i in anchors) {
      const anchor = anchors[i]
      expectPresent(anchor)
      expect(anchor.proofCid).toEqual(ipfsProofCid.toString())
      const request = requests.find((r) => r.id === anchor.requestId)
      expectPresent(request)
      expect(anchor.requestId).toEqual(request.id)

      const anchorRecord = await ipfsService.retrieveRecord(anchor.cid)
      expect(anchorRecord.prev.toString()).toEqual(request.cid)
      expect(anchorRecord.proof).toEqual(ipfsProofCid)
      expect(anchorRecord.path).toEqual(anchor.path)
      expect(mockIpfsClient.pubsub.publish.mock.calls[i][0]).toEqual(config.ipfsConfig.pubsubTopic)
      expect(mockIpfsClient.pubsub.publish.mock.calls[i][1]).toBeInstanceOf(Uint8Array)
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
    for (let i = 0; i < numRequests; i++) {
      const genesisCID = await ipfsService.storeRecord({
        header: {
          controllers: [`did:method:${randomString(32)}`],
        },
      })
      const streamId = new StreamID(1, genesisCID)
      await metadataService.fillFromIpfs(streamId)

      await createRequest(streamId.toString(), ipfsService, requestRepository)
    }

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
      const genesisCID = await ipfsService.storeRecord({
        header: {
          controllers: [`did:method:${randomString(32)}`],
        },
      })
      const streamId = new StreamID(1, genesisCID)
      await metadataService.fillFromIpfs(streamId)

      const status = failedIndex > 0 ? RequestStatus.FAILED : RequestStatus.PENDING
      const request = await createRequest(
        streamId.toString(),
        ipfsService,
        requestRepository,
        status
      )
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
      const streamId = prevRequest.streamId

      const request = await createRequest(
        streamId.toString(),
        ipfsService,
        requestRepository,
        RequestStatus.PENDING
      )
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

    // Make sure, that `requests` and `storedRequests` contain _same_ Requests at different stages of their lifecycle.
    // `requests` contain "vanilla" just created entries. `storedRequests` contains entries after a round of anchoring,
    // and few of them are marked as REPLACED, to imitate how CAS requests are created.

    // Make sure these are same records in the same order
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
    for (let i = 0; i < numRequests; i++) {
      const genesisCID = await ipfsService.storeRecord({
        header: {
          controllers: [`did:method:${randomString(32)}`],
        },
      })
      const streamId = new StreamID(1, genesisCID)
      await metadataService.fillFromIpfs(streamId)
      await createRequest(streamId.toString(), ipfsService, requestRepository)
    }

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

  test('filters anchors that fail to publish AnchorCommit', async () => {
    // Create pending requests
    const numRequests = 4
    for (let i = 0; i < numRequests; i++) {
      const genesisCID = await ipfsService.storeRecord({
        header: {
          controllers: [`did:method:${randomString(32)}`],
        },
      })
      const streamId = new StreamID(1, genesisCID)
      await metadataService.fillFromIpfs(streamId)
      await createRequest(streamId.toString(), ipfsService, requestRepository)
    }

    await requestRepository.findAndMarkReady(numRequests)
    const requests = await requestRepository.findByStatus(RequestStatus.READY)

    expect(requests.length).toEqual(numRequests)
    const [candidates] = await anchorService._findCandidates(requests, 0)
    expect(candidates.length).toEqual(numRequests)

    const originalMockDagPut = mockIpfsClient.dag.put.getMockImplementation()
    mockIpfsClient.dag.put.mockImplementation(async (ipfsAnchorCommit: any) => {
      expectPresent(requests[1])
      if (ipfsAnchorCommit.prev && ipfsAnchorCommit.prev.toString() == requests[1].cid.toString()) {
        throw new Error('storing record failed')
      }

      return originalMockDagPut(ipfsAnchorCommit)
    })

    const originalMockPubsubPublish = mockIpfsClient.pubsub.publish.getMockImplementation()
    mockIpfsClient.pubsub.publish.mockImplementation(async (topic: string, message: Uint8Array) => {
      const deserializedMessage = PubsubMessage.deserialize({
        data: message,
      }) as PubsubMessage.UpdateMessage

      expectPresent(requests[3])
      if (deserializedMessage.stream.toString() == requests[3].streamId.toString()) {
        throw new Error('publishing update failed')
      }

      return originalMockPubsubPublish(topic, message)
    })

    const anchors = await anchorCandidates(candidates, anchorService, ipfsService)
    expect(anchors.length).toEqual(2)
    const isFound = (r: Request) => anchors.find((anchor) => anchor.requestId === r.id)
    expectPresent(requests[0])
    expect(isFound(requests[0])).toBeTruthy()
    expectPresent(requests[1])
    expect(isFound(requests[1])).toBeFalsy()
    expectPresent(requests[2])
    expect(isFound(requests[2])).toBeTruthy()
    expectPresent(requests[3])
    expect(isFound(requests[3])).toBeFalsy()
  })

  test('will not throw if no anchor commits were created', async () => {
    const requestRepository = injector.resolve('requestRepository')
    const anchorService = injector.resolve('anchorService')

    const anchorLimit = 2
    const numRequests = 2

    // Create pending requests
    for (let i = 0; i < numRequests; i++) {
      const genesisCID = await ipfsService.storeRecord({
        header: {
          controllers: [`did:method:${randomString(32)}`],
        },
      })
      const streamId = new StreamID(1, genesisCID)
      await metadataService.fillFromIpfs(streamId)
      await createRequest(streamId.toString(), ipfsService, requestRepository)
    }

    await requestRepository.findAndMarkReady(anchorLimit)

    const requests = await requestRepository.findByStatus(RequestStatus.READY)
    expect(requests.length).toEqual(numRequests)
    const [candidates] = await anchorService._findCandidates(requests, anchorLimit)
    expect(candidates.length).toEqual(numRequests)

    const original = anchorService._createAnchorCommit
    try {
      anchorService._createAnchorCommit = async () => {
        return null
      }
      await anchorCandidates(candidates, anchorService, ipfsService)
    } finally {
      anchorService._createAnchorCommit = original
    }
  })

  test('Does not create anchor commits if stream has already been anchored for those requests', async () => {
    const requestRepository = injector.resolve('requestRepository')
    const anchorService = injector.resolve('anchorService')

    const anchorLimit = 0 // 0 means infinity
    const numRequests = 5

    // Create pending requests
    for (let i = 0; i < numRequests; i++) {
      const genesisCID = await ipfsService.storeRecord({
        header: {
          controllers: [`did:method:${randomString(32)}`],
        },
      })
      const streamId = new StreamID(1, genesisCID)
      await metadataService.fillFromIpfs(streamId)
      await createRequest(streamId.toString(), ipfsService, requestRepository)
    }

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

    // reanchor the same candidates
    await anchorCandidates(candidates, anchorService, ipfsService)

    // no new anchor should have been created
    anchors = await requestRepository.table
    expect(anchors.length).toEqual(numRequests)
  })

  describe('Request pinning', () => {
    async function anchorRequests(numRequests: number): Promise<Request[]> {
      // Create Requests
      const streamIds = []
      for (let i = 0; i < numRequests; i++) {
        const genesisCID = await ipfsService.storeRecord({
          header: {
            controllers: [`did:method:${randomString(32)}`],
          },
        })
        const streamId = new StreamID(1, genesisCID)
        await metadataService.fillFromIpfs(streamId)
        streamIds.push(streamId)
      }
      // const streamIds = Array.from({ length: numRequests }).map(() => randomStreamID())
      const requests = await Promise.all(
        streamIds.map((streamId) =>
          createRequest(streamId.toString(), ipfsService, requestRepository)
        )
      )

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
        await requestRepository.createRequests(originalRequests)
        await anchorService.emitAnchorEventIfReady()

        expect(requestRepositoryUpdateSpy).toHaveBeenCalledTimes(0)
        expect(eventProducerService.emitAnchorEvent.mock.calls.length).toEqual(0)
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

      await anchorService.emitAnchorEventIfReady()

      expect(requestRepositoryUpdateSpy).toHaveBeenCalledTimes(1)

      const updatedRequests = await requestRepository.findByStatus(RequestStatus.COMPLETED)

      expect(updatedRequests.every(({ updatedAt }) => updatedAt > updatedTooLongAgo)).toEqual(true)

      expect(eventProducerService.emitAnchorEvent.mock.calls.length).toEqual(1)
      expectPresent(eventProducerService.emitAnchorEvent.mock.calls[0])
      expect(validateUUID(eventProducerService.emitAnchorEvent.mock.calls[0][0])).toEqual(true)
      requestRepositoryUpdateSpy.mockRestore()
    })

    test('does not emit if no requests were updated to ready', async () => {
      // not enough request generated
      const originalRequests = generateRequests(
        {
          status: RequestStatus.PENDING,
        },
        MIN_STREAM_COUNT - 1
      )

      await requestRepository.createRequests(originalRequests)
      await anchorService.emitAnchorEventIfReady()
      expect(eventProducerService.emitAnchorEvent.mock.calls.length).toEqual(0)
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
      await anchorService.emitAnchorEventIfReady()

      expect(eventProducerService.emitAnchorEvent.mock.calls.length).toEqual(1)
      expectPresent(eventProducerService.emitAnchorEvent.mock.calls[0])
      expect(validateUUID(eventProducerService.emitAnchorEvent.mock.calls[0][0])).toEqual(true)

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
      expect(eventProducerService.emitAnchorEvent.mock.calls.length).toEqual(0)
    })
  })

  test('IpfsService storeRecord() pins records', async () => {
    const cid = await ipfsService.storeRecord({})
    expect(mockIpfsClient.dag.put).toHaveBeenCalledTimes(1)
    expect(mockIpfsClient.pin.add).toHaveBeenCalledTimes(1)
    expect(mockIpfsClient.pin.add).toHaveBeenCalledWith(cid, {
      signal: undefined,
      timeout: 30000,
      recursive: false,
    })
  })
})
