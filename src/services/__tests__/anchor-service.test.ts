import 'reflect-metadata'
import { jest } from '@jest/globals'
import { container } from 'tsyringe'

import { Request } from '../../models/request.js'
import { RequestStatus } from '../../models/request-status.js'
import { AnchorService } from '../anchor-service.js'

import { DBConnection } from './db-connection.js'

import { RequestRepository } from '../../repositories/request-repository.js'
import { IpfsService } from '../ipfs-service.js'
import { AnchorRepository } from '../../repositories/anchor-repository.js'
import { config } from 'node-config-ts'
import { CommitID, StreamID } from '@ceramicnetwork/streamid'
import { MockCeramicService, MockIpfsService } from '../../test-utils.js'
import type { Connection } from 'typeorm'
import { CID } from 'multiformats/cid'
import { Candidate } from '../../merkle/merkle-objects.js'
import { Anchor } from '../../models/anchor.js'
import { AnchorStatus, toCID } from '@ceramicnetwork/common'
import cloneDeep from 'lodash.clonedeep'
import { Utils } from '../../utils.js'

process.env.NODE_ENV = 'test'

class FakeEthereumBlockchainService {
  constructor() {}

  public sendTransaction() {
    throw new Error('Failed to send transaction!')
  }
}

async function createRequest(streamId: string, ipfsService: IpfsService): Promise<Request> {
  const cid = await ipfsService.storeRecord({})
  const request = new Request()
  request.cid = cid.toString()
  request.streamId = streamId
  request.status = RequestStatus.PENDING
  request.message = 'Request is pending.'
  request.pinned = true
  return request
}

async function anchorCandidates(
  candidates: Candidate[],
  anchorService,
  ipfsService
): Promise<Anchor[]> {
  const merkleTree = await anchorService._buildMerkleTree(candidates)
  const ipfsProofCid = await ipfsService.storeRecord({})
  const anchors = await anchorService._createAnchorCommits(ipfsProofCid, merkleTree)
  await anchorService._persistAnchorResult(anchors, candidates)
  return anchors
}

function createStream(id: StreamID, log: CID[], anchorStatus: AnchorStatus = AnchorStatus.PENDING) {
  return {
    id,
    metadata: { controllers: ['this is totally a did'] },
    state: {
      log: log.map((cid) => {
        return { cid }
      }),
      anchorStatus,
    },
    tip: log[log.length - 1],
  }
}

describe('anchor service', () => {
  jest.setTimeout(10000)
  let ipfsService: MockIpfsService
  let ceramicService: MockCeramicService
  let connection: Connection

  beforeAll(async () => {
    connection = await DBConnection.create()
    ipfsService = new MockIpfsService()
    ceramicService = new MockCeramicService(ipfsService)

    container.registerInstance('config', config)
    container.registerInstance('dbConnection', connection)
    container.registerSingleton('anchorRepository', AnchorRepository)
    container.registerSingleton('requestRepository', RequestRepository)
    container.registerSingleton('blockchainService', FakeEthereumBlockchainService)
    container.register('ipfsService', {
      useValue: ipfsService,
    })
    container.register('ceramicService', {
      useValue: ceramicService,
    })
    container.registerSingleton('anchorService', AnchorService)
  })

  beforeEach(async () => {
    await DBConnection.clear(connection)
    ipfsService.reset()
    ceramicService.reset()
  })

  afterAll(async () => {
    await DBConnection.close(connection)
  })

  test('check state on tx fail', async () => {
    const streamId = await ceramicService.generateBaseStreamID()
    const cid = await ipfsService.storeRecord({})
    const streamCommitId = CommitID.make(streamId, cid)
    const stream = createStream(streamId, [cid])
    ceramicService.putStream(streamCommitId, stream)
    ceramicService.putStream(streamId, stream)

    let request = new Request()
    request.cid = cid.toString()
    request.streamId = streamId.toString()
    request.status = RequestStatus.PENDING
    request.message = 'Request is pending.'

    const requestRepository = container.resolve<RequestRepository>('requestRepository')
    await requestRepository.createOrUpdate(request)

    const anchorService = container.resolve<AnchorService>('anchorService')
    await expect(anchorService.anchorRequests()).rejects.toEqual(
      new Error('Failed to send transaction!')
    )

    request = await requestRepository.findByCid(cid)
    expect(request).toHaveProperty('status', RequestStatus.PENDING)

    const requests = await requestRepository.findNextToProcess(100)
    expect(requests).toBeDefined()
    expect(requests).toBeInstanceOf(Array)
    expect(requests).toHaveLength(1)
  })

  test('create anchor records', async () => {
    const requestRepository = container.resolve<RequestRepository>('requestRepository')
    const anchorService = container.resolve<AnchorService>('anchorService')

    // Create pending requests
    const requests = []
    const numRequests = 4
    for (let i = 0; i < numRequests; i++) {
      const streamId = await ceramicService.generateBaseStreamID()
      const request = await createRequest(streamId.toString(), ipfsService)
      await requestRepository.createOrUpdate(request)
      requests.push(request)
      const commitId = CommitID.make(streamId, request.cid)
      const stream = createStream(streamId, [toCID(request.cid)])
      ceramicService.putStream(streamId, stream)
      ceramicService.putStream(commitId, stream)
    }
    requests.sort(function (a, b) {
      return a.streamId.localeCompare(b.streamId)
    })

    const [candidates, _] = await anchorService._findCandidates(requests, 0, 1)
    const merkleTree = await anchorService._buildMerkleTree(candidates)
    const ipfsProofCid = await ipfsService.storeRecord({})

    const anchors = await anchorService._createAnchorCommits(ipfsProofCid, merkleTree)

    expect(candidates.length).toEqual(requests.length)
    expect(anchors.length).toEqual(candidates.length)

    for (const i in anchors) {
      const anchor = anchors[i]
      expect(anchor.proofCid).toEqual(ipfsProofCid.toString())
      expect(anchor.request).toEqual(requests[i])

      const anchorRecord = await ipfsService.retrieveRecord(anchor.cid)
      expect(anchorRecord.prev.toString()).toEqual(requests[i].cid)
      expect(anchorRecord.proof).toEqual(ipfsProofCid)
      expect(anchorRecord.path).toEqual(anchor.path)
    }

    expect(anchors[0].path).toEqual('0/0')
    expect(anchors[1].path).toEqual('0/1')
    expect(anchors[2].path).toEqual('1/0')
    expect(anchors[3].path).toEqual('1/1')
  })

  test('Too few anchor requests', async () => {
    const requestRepository = container.resolve<RequestRepository>('requestRepository')
    const anchorService = container.resolve<AnchorService>('anchorService')

    const anchorLimit = 8
    const numRequests = anchorLimit / 2 - 1 // Batch is less than half full

    // Create pending requests
    for (let i = 0; i < numRequests; i++) {
      const streamId = await ceramicService.generateBaseStreamID()
      const request = await createRequest(streamId.toString(), ipfsService)
      await requestRepository.createOrUpdate(request)
      const commitId = CommitID.make(streamId, request.cid)
      const stream = createStream(streamId, [toCID(request.cid)])
      ceramicService.putStream(streamId, stream)
      ceramicService.putStream(commitId, stream)
    }

    const requests = await requestRepository.findNextToProcess(100)
    expect(requests.length).toEqual(numRequests)
    // If we can't find at least half the desired number of candidates, we actually return 0
    // candidates so as to skip the batch entirely
    const [candidates, _] = await anchorService._findCandidates(
      requests,
      anchorLimit,
      anchorLimit / 2
    )
    expect(candidates.length).toEqual(0)
  })

  test('Too many anchor requests', async () => {
    const requestRepository = container.resolve<RequestRepository>('requestRepository')
    const anchorService = container.resolve<AnchorService>('anchorService')

    const anchorLimit = 4
    const numRequests = anchorLimit * 2 // twice as many requests as can fit

    // Create pending requests
    for (let i = 0; i < numRequests; i++) {
      const streamId = await ceramicService.generateBaseStreamID()
      const request = await createRequest(streamId.toString(), ipfsService)
      await requestRepository.createOrUpdate(request)
      const commitId = CommitID.make(streamId, request.cid)
      const stream = createStream(streamId, [toCID(request.cid)])
      ceramicService.putStream(streamId, stream)
      ceramicService.putStream(commitId, stream)
    }

    // First pass anchors half the pending requests
    let requests = await requestRepository.findNextToProcess(100)
    expect(requests.length).toEqual(numRequests)
    const anchorPendingRequests = async function (requests: Request[]): Promise<void> {
      const [candidates, _] = await anchorService._findCandidates(requests, anchorLimit, 1)
      expect(candidates.length).toEqual(anchorLimit)

      await anchorCandidates(candidates, anchorService, ipfsService)
    }
    await anchorPendingRequests(requests)

    requests = await requestRepository.findNextToProcess(100)
    expect(requests.length).toEqual(numRequests / 2)

    // Second pass anchors the remaining half of the original requests
    await anchorPendingRequests(requests)

    // All requests should have been processed
    requests = await requestRepository.findNextToProcess(100)
    expect(requests.length).toEqual(0)
  })

  test('Anchors in request order', async () => {
    const requestRepository = container.resolve<RequestRepository>('requestRepository')
    const anchorService = container.resolve<AnchorService>('anchorService')

    const anchorLimit = 4
    const numStreams = anchorLimit * 2 // twice as many streams as can fit in a batch

    // Create pending requests
    // We want 2 requests per streamId, but don't want the requests on the same stream to be created
    // back-to-back.  So we do one pass to generate the first request for each stream, then another
    // to make the second requests.
    const requests = []
    for (let i = 0; i < numStreams; i++) {
      const streamId = await ceramicService.generateBaseStreamID()

      const request = await createRequest(streamId.toString(), ipfsService)
      await requestRepository.createOrUpdate(request)
      requests.push(request)

      // Make sure each stream gets a unique 'createdAt' Date
      await Utils.delay(1000)
    }

    // Second pass, a second request per stream.  Create the 2nd request per stream in the opposite
    // order from how the first request per stream was.
    for (let i = numStreams - 1; i >= 0; i--) {
      const prevRequest = requests[i]
      const streamId = prevRequest.streamId

      const request = await createRequest(streamId.toString(), ipfsService)
      await requestRepository.createOrUpdate(request)
      requests.push(request)
      const stream = createStream(streamId, [toCID(prevRequest.cid), toCID(request.cid)])
      ceramicService.putStream(streamId, stream)

      // Make sure each stream gets a unique 'createdAt' Date
      await Utils.delay(1000)
    }

    // First pass anchors half the pending requests
    expect((await requestRepository.findNextToProcess(100)).length).toEqual(requests.length)
    const anchorPendingRequests = async function (requests: Request[]): Promise<void> {
      const [candidates, _] = await anchorService._findCandidates(requests, anchorLimit, 1)
      expect(candidates.length).toEqual(anchorLimit)

      await anchorCandidates(candidates, anchorService, ipfsService)
    }
    await anchorPendingRequests(requests)

    const remainingRequests = await requestRepository.findNextToProcess(100)
    expect(remainingRequests.length).toEqual(requests.length / 2)

    for (let i = 0; i < anchorLimit; i++) {
      // The first 'anchorLimit' requests created should have been anchored, so should not show up
      // as remaining
      const remaining = remainingRequests.find((req) => req.id == requests[i].id)
      expect(remaining).toBeFalsy()
    }

    for (let i = anchorLimit; i < numStreams; i++) {
      // The remaining half of the requests from the first batch created are on streams that
      // weren't included in the batch, and so should still be remaining
      const remaining = remainingRequests.find((req) => req.id == requests[i].id)
      expect(remaining).toBeTruthy()
    }

    for (let i = numStreams; i < numStreams + anchorLimit; i++) {
      // The earlier created requests from the second request batch correspond to the later
      // created streams, and thus should still be remaining
      const remaining = remainingRequests.find((req) => req.id == requests[i].id)
      expect(remaining).toBeTruthy()
    }

    for (let i = numStreams + anchorLimit; i < numStreams * 2; i++) {
      // The later created requests from the second request batch correspond to the earlier
      // created streams, and thus should be anchored and not remaining
      const remaining = remainingRequests.find((req) => req.id == requests[i].id)
      expect(remaining).toBeFalsy()
    }
  }, 30000)

  test('Unlimited anchor requests', async () => {
    const requestRepository = container.resolve<RequestRepository>('requestRepository')
    const anchorService = container.resolve<AnchorService>('anchorService')

    const anchorLimit = 0 // 0 means infinity
    const numRequests = 5

    // Create pending requests
    for (let i = 0; i < numRequests; i++) {
      const streamId = await ceramicService.generateBaseStreamID()
      const request = await createRequest(streamId.toString(), ipfsService)
      await requestRepository.createOrUpdate(request)
      const commitId = CommitID.make(streamId, request.cid)
      const stream = createStream(streamId, [toCID(request.cid)])
      ceramicService.putStream(streamId, stream)
      ceramicService.putStream(commitId, stream)
    }

    let requests = await requestRepository.findNextToProcess(100)
    expect(requests.length).toEqual(numRequests)
    const [candidates, _] = await anchorService._findCandidates(requests, anchorLimit, 1)
    expect(candidates.length).toEqual(numRequests)
    await anchorCandidates(candidates, anchorService, ipfsService)

    // All requests should have been processed
    requests = await requestRepository.findNextToProcess(100)
    expect(requests.length).toEqual(0)
  })

  test('filters invalid requests', async () => {
    const requestRepository = container.resolve<RequestRepository>('requestRepository')
    const anchorService = container.resolve<AnchorService>('anchorService')

    const makeRequest = async function (valid: boolean) {
      const streamId = await ceramicService.generateBaseStreamID()
      const request = await createRequest(streamId.toString(), ipfsService)
      await requestRepository.createOrUpdate(request)

      if (valid) {
        const commitId = CommitID.make(streamId, request.cid)
        const stream = createStream(streamId, [toCID(request.cid)])
        ceramicService.putStream(streamId, stream)
        ceramicService.putStream(commitId, stream)
      }

      return request
    }

    const requests = []
    for (const isValid of [true, false, true, false]) {
      const request = await makeRequest(isValid)
      requests.push(request)
    }

    const [candidates, _] = await anchorService._findCandidates(requests, 0, 1)
    expect(candidates.length).toEqual(2)

    const request0 = await requestRepository.findByCid(toCID(requests[0].cid))
    const request1 = await requestRepository.findByCid(toCID(requests[1].cid))
    const request2 = await requestRepository.findByCid(toCID(requests[2].cid))
    const request3 = await requestRepository.findByCid(toCID(requests[3].cid))
    expect(request0.status).toEqual(RequestStatus.PENDING)
    expect(request1.status).toEqual(RequestStatus.FAILED)
    expect(request2.status).toEqual(RequestStatus.PENDING)
    expect(request3.status).toEqual(RequestStatus.FAILED)
  })

  test('sends multiquery for missing commits', async () => {
    const requestRepository = container.resolve<RequestRepository>('requestRepository')
    const anchorService = container.resolve<AnchorService>('anchorService')

    const makeRequest = async function (streamId: StreamID, includeInBaseStream: boolean) {
      const request = await createRequest(streamId.toString(), ipfsService)
      await requestRepository.createOrUpdate(request)
      const commitId = CommitID.make(streamId, request.cid)

      const existingStream = await ceramicService.loadStream(streamId).catch(() => null)
      let streamWithCommit
      if (existingStream) {
        const log = cloneDeep(existingStream.state.log).map(({ cid }) => cid)
        log.push(toCID(request.cid))
        streamWithCommit = createStream(streamId, log)
      } else {
        streamWithCommit = createStream(streamId, [toCID(request.cid)])
      }

      ceramicService.putStream(commitId, streamWithCommit)

      if (includeInBaseStream) {
        ceramicService.putStream(streamId, streamWithCommit)
      }

      return request
    }

    // One stream where 1 commit is present in the stream in ceramic already and one commit is not
    const streamIdA = await ceramicService.generateBaseStreamID()
    const requestA0 = await makeRequest(streamIdA, true)
    const requestA1 = await makeRequest(streamIdA, false)
    // A second stream where both commits are included in the ceramic already
    const streamIdB = await ceramicService.generateBaseStreamID()
    const requestB0 = await makeRequest(streamIdB, true)
    const requestB1 = await makeRequest(streamIdB, true)

    // Set up mock multiquery implementation to make sure that it finds requestA1 in streamA,
    // even though it isn't there in the MockCeramicService
    const commitIdA1 = CommitID.make(streamIdA, requestA1.cid)
    const streamAWithRequest1 = await ceramicService.loadStream(commitIdA1.toString() as any)
    const multiQuerySpy = jest.spyOn(ceramicService, 'multiQuery')
    multiQuerySpy.mockImplementationOnce(async (queries) => {
      const result = {}
      result[streamIdA.toString()] = streamAWithRequest1
      result[commitIdA1.toString()] = streamAWithRequest1
      return result
    })

    const [candidates, _] = await anchorService._findCandidates(
      [requestA0, requestA1, requestB0, requestB1],
      0,
      1
    )
    expect(candidates.length).toEqual(2)
    expect(candidates[0].streamId.toString()).toEqual(streamIdA.toString())
    expect(candidates[0].cid.toString()).toEqual(requestA1.cid)
    expect(candidates[1].streamId.toString()).toEqual(streamIdB.toString())
    expect(candidates[1].cid.toString()).toEqual(requestB1.cid)

    // Should only get 1 multiquery, for streamA.  StreamB already had all commits included so no
    // need to issue multiquery
    expect(multiQuerySpy).toHaveBeenCalledTimes(1)
    expect(multiQuerySpy.mock.calls[0][0].length).toEqual(2)
    expect(multiQuerySpy.mock.calls[0][0][0].streamId.toString()).toEqual(commitIdA1.toString())
    expect(multiQuerySpy.mock.calls[0][0][1].streamId.toString()).toEqual(streamIdA.toString())

    multiQuerySpy.mockRestore()
  })

  test('filters anchors that fail to publish AnchorCommit', async () => {
    const requestRepository = container.resolve<RequestRepository>('requestRepository')
    const anchorService = container.resolve<AnchorService>('anchorService')

    // Create pending requests
    const numRequests = 3
    for (let i = 0; i < numRequests; i++) {
      const streamId = await ceramicService.generateBaseStreamID()
      const request = await createRequest(streamId.toString(), ipfsService)
      await requestRepository.createOrUpdate(request)
      const commitId = CommitID.make(streamId, request.cid)
      const stream = createStream(streamId, [toCID(request.cid)])
      ceramicService.putStream(streamId, stream)
      ceramicService.putStream(commitId, stream)
    }

    const requests = await requestRepository.findNextToProcess(100)
    expect(requests.length).toEqual(numRequests)
    const [candidates, _] = await anchorService._findCandidates(requests, 0, 1)
    expect(candidates.length).toEqual(numRequests)

    const originalStoreRecord = ipfsService.storeRecord
    const storeRecordSpy = jest.spyOn(ipfsService, 'storeRecord')
    storeRecordSpy.mockImplementation(async (ipfsAnchorCommit) => {
      if (ipfsAnchorCommit.prev && ipfsAnchorCommit.prev.toString() == requests[1].cid.toString()) {
        throw new Error('publishing anchor commit failed')
      }

      return originalStoreRecord.apply(ceramicService, [ipfsAnchorCommit])
    })

    const anchors = await anchorCandidates(candidates, anchorService, ipfsService)
    expect(anchors.length).toEqual(2)
    expect(anchors.find((anchor) => anchor.request.streamId == requests[0].streamId)).toBeTruthy()
    expect(anchors.find((anchor) => anchor.request.streamId == requests[1].streamId)).toBeFalsy()
    expect(anchors.find((anchor) => anchor.request.streamId == requests[2].streamId)).toBeTruthy()
    storeRecordSpy.mockRestore()
  })

  describe('Picks proper commit to anchor', () => {
    test('Anchor more recent of two commits', async () => {
      const requestRepository = container.resolve<RequestRepository>('requestRepository')
      const anchorService = container.resolve<AnchorService>('anchorService')

      // 1 stream with 2 pending requests, one request is newer and inclusive of the other.
      const streamId = await ceramicService.generateBaseStreamID()
      const request0 = await createRequest(streamId.toString(), ipfsService)
      const request1 = await createRequest(streamId.toString(), ipfsService)
      await requestRepository.createOrUpdate(request0)
      await requestRepository.createOrUpdate(request1)
      const commitId0 = CommitID.make(streamId, request0.cid)
      const commitId1 = CommitID.make(streamId, request1.cid)

      // request1 is the most recent tip
      ceramicService.putStream(commitId0, createStream(streamId, [toCID(request0.cid)]))
      ceramicService.putStream(
        commitId1,
        createStream(streamId, [toCID(request0.cid), toCID(request1.cid)])
      )
      ceramicService.putStream(
        streamId,
        createStream(streamId, [toCID(request0.cid), toCID(request1.cid)])
      )

      const [candidates, _] = await anchorService._findCandidates([request0, request1], 0, 1)
      const anchors = await anchorCandidates(candidates, anchorService, ipfsService)
      expect(candidates.length).toEqual(1)
      const candidate = candidates[0]
      expect(candidate.streamId).toEqual(streamId)
      expect(candidate.cid.toString()).toEqual(request1.cid)

      // Both requests should be marked as completed
      const updatedRequest0 = await requestRepository.findByCid(toCID(request0.cid))
      const updatedRequest1 = await requestRepository.findByCid(toCID(request1.cid))
      expect(updatedRequest0.status).toEqual(RequestStatus.COMPLETED)
      expect(updatedRequest1.status).toEqual(RequestStatus.COMPLETED)

      // Anchor should have selected request1's CID
      expect(anchors.length).toEqual(1)
      const anchor = anchors[0]
      const anchorCommit = await ipfsService.retrieveRecord(anchor.cid)
      expect(anchorCommit.prev.toString()).toEqual(request1.cid)
      expect(anchor.request.id).toEqual(request1.id)
    })

    test('Anchors commit more recent than any requests', async () => {
      const requestRepository = container.resolve<RequestRepository>('requestRepository')
      const anchorService = container.resolve<AnchorService>('anchorService')

      const streamId = await ceramicService.generateBaseStreamID()
      const request = await createRequest(streamId.toString(), ipfsService)
      await requestRepository.createOrUpdate(request)
      const commitId = CommitID.make(streamId, request.cid)
      const tipCID = await ipfsService.storeRecord({})

      // The most recent tip doesn't have a corresponding request, but includes the pending
      // request CID.
      ceramicService.putStream(commitId, createStream(streamId, [toCID(request.cid)]))
      ceramicService.putStream(streamId, createStream(streamId, [toCID(request.cid), tipCID]))

      const [candidates, _] = await anchorService._findCandidates([request], 0, 1)
      const anchors = await anchorCandidates(candidates, anchorService, ipfsService)
      expect(candidates.length).toEqual(1)
      const candidate = candidates[0]
      expect(candidate.streamId).toEqual(streamId)
      expect(candidate.cid.toString()).toEqual(tipCID.toString())

      // request should be marked as completed
      const updatedRequest = await requestRepository.findByCid(toCID(request.cid))
      expect(updatedRequest.status).toEqual(RequestStatus.COMPLETED)

      // Anchor should have selected tipCID
      expect(anchors.length).toEqual(1)
      const anchor = anchors[0]
      const anchorCommit = await ipfsService.retrieveRecord(anchor.cid)
      expect(anchorCommit.prev.toString()).toEqual(tipCID.toString())
      // The request should still have been marked in the anchor database
      expect(anchor.request.id).toEqual(request.id)
    })

    test('No anchor performed if no valid requests', async () => {
      const requestRepository = container.resolve<RequestRepository>('requestRepository')
      const anchorService = container.resolve<AnchorService>('anchorService')

      const streamId = await ceramicService.generateBaseStreamID()
      const request = await createRequest(streamId.toString(), ipfsService)
      await requestRepository.createOrUpdate(request)
      const commitId = CommitID.make(streamId, request.cid)
      const tipCID = await ipfsService.storeRecord({})

      // The most recent tip doesn't have a corresponding request, and does *not* include the pending
      // request CID.
      ceramicService.putStream(commitId, createStream(streamId, [toCID(request.cid)]))
      ceramicService.putStream(streamId, createStream(streamId, [tipCID]))

      const [candidates, _] = await anchorService._findCandidates([request], 0, 1)
      expect(candidates.length).toEqual(0)
      const updatedRequest = await requestRepository.findByCid(toCID(request.cid))
      expect(updatedRequest.status).toEqual(RequestStatus.FAILED)
    })

    test('Request succeeds without anchor for already anchored CIDs', async () => {
      const requestRepository = container.resolve<RequestRepository>('requestRepository')
      const anchorService = container.resolve<AnchorService>('anchorService')

      const streamId = await ceramicService.generateBaseStreamID()
      const request = await createRequest(streamId.toString(), ipfsService)
      await requestRepository.createOrUpdate(request)
      const commitId = CommitID.make(streamId, request.cid)
      const anchorCommitCID = await ipfsService.storeRecord({})

      // The most recent tip doesn't have a corresponding request, but includes the pending
      // request CID.
      ceramicService.putStream(commitId, createStream(streamId, [toCID(request.cid)]))
      ceramicService.putStream(
        streamId,
        createStream(streamId, [toCID(request.cid), anchorCommitCID], AnchorStatus.ANCHORED)
      )

      const [candidates, _] = await anchorService._findCandidates([request], 0, 1)
      expect(candidates.length).toEqual(0)

      // request should still be marked as completed even though no anchor was performed
      const updatedRequest = await requestRepository.findByCid(toCID(request.cid))
      expect(updatedRequest.status).toEqual(RequestStatus.COMPLETED)
    })
  })

  describe('Request pinning', () => {
    async function anchorRequests(numRequests: number): Promise<Request[]> {
      const requestRepository = container.resolve<RequestRepository>('requestRepository')
      const anchorService = container.resolve<AnchorService>('anchorService')

      // Create Requests
      const streamIds = await Promise.all(
        [...Array(numRequests)].map(() => ceramicService.generateBaseStreamID())
      )
      const requests = await Promise.all(
        streamIds.map((streamId) => createRequest(streamId.toString(), ipfsService))
      )
      await requestRepository.createRequests(requests)

      // Create streams in Ceramic
      for (let i = 0; i < numRequests; i++) {
        const request = requests[i]
        const streamId = streamIds[i]
        const commitId = CommitID.make(streamId, request.cid)

        const stream = createStream(streamId, [toCID(request.cid)])
        ceramicService.putStream(commitId, stream)
        ceramicService.putStream(streamId, stream)
      }

      const [candidates, _] = await anchorService._findCandidates(requests, 0, 1)
      await anchorCandidates(candidates, anchorService, ipfsService)
      expect(candidates.length).toEqual(numRequests)

      return requests
    }

    test('Successful anchor pins request', async () => {
      const requestRepository = container.resolve<RequestRepository>('requestRepository')

      const [request0] = await anchorRequests(1)

      // Request should be marked as completed and pinned
      const updatedRequest0 = await requestRepository.findByCid(toCID(request0.cid))
      expect(updatedRequest0.status).toEqual(RequestStatus.COMPLETED)
      expect(updatedRequest0.cid).toEqual(request0.cid)
      expect(updatedRequest0.message).toEqual('CID successfully anchored.')
      expect(updatedRequest0.pinned).toEqual(true)

      console.log(updatedRequest0.updatedAt.toISOString())
    })

    test('Request garbage collection', async () => {
      const requestRepository = container.resolve<RequestRepository>('requestRepository')
      const anchorService = container.resolve<AnchorService>('anchorService')

      const requestCIDs = (await anchorRequests(3)).map((request) => request.cid)
      const requests = await Promise.all(
        requestCIDs.map((cid) => requestRepository.findByCid(toCID(cid)))
      )

      const now = new Date()
      const TWO_MONTHS = 1000 * 60 * 60 * 24 * 60
      const expiredDate = new Date(now.getTime() - TWO_MONTHS)

      // Make 2 of the 3 requests be expired
      requests[0].updatedAt = expiredDate
      requests[1].updatedAt = expiredDate
      await requestRepository.createOrUpdate(requests[0])
      await requestRepository.createOrUpdate(requests[1])

      // run garbage collection
      const unpinStreamSpy = jest.spyOn(ceramicService, 'unpinStream')
      await anchorService.garbageCollectPinnedStreams()

      const updatedRequests = await Promise.all(
        requests.map((req) => requestRepository.findByCid(toCID(req.cid)))
      )
      // Expired requests should be unpinned, but recent request should still be pinned
      expect(updatedRequests[0].pinned).toBeFalsy()
      expect(updatedRequests[1].pinned).toBeFalsy()
      expect(updatedRequests[2].pinned).toBeTruthy()
      expect(unpinStreamSpy).toHaveBeenCalledTimes(2)

      // Running garbage collection on already unpinned streams shouldn't unpin again
      updatedRequests[0].updatedAt = expiredDate
      await requestRepository.createOrUpdate(updatedRequests[0])
      await anchorService.garbageCollectPinnedStreams()

      const finalRequests = await Promise.all(
        updatedRequests.map((req) => requestRepository.findByCid(toCID(req.cid)))
      )
      expect(finalRequests[0].pinned).toBeFalsy()
      expect(finalRequests[1].pinned).toBeFalsy()
      expect(finalRequests[2].pinned).toBeTruthy()
      // No additional calls to unpinStream
      expect(unpinStreamSpy).toHaveBeenCalledTimes(2)
    })
  })
})
