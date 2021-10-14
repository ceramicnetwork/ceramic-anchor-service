import 'reflect-metadata'
import { container } from 'tsyringe'

import { Request } from '../../models/request'
import { RequestStatus } from '../../models/request-status'
import AnchorService from '../anchor-service'

import DBConnection from './db-connection'

import EthereumBlockchainService from '../blockchain/ethereum/ethereum-blockchain-service'
import RequestRepository from '../../repositories/request-repository'
import { IpfsService } from '../ipfs-service'
import AnchorRepository from '../../repositories/anchor-repository'
import { config } from 'node-config-ts'
import { StreamID } from '@ceramicnetwork/streamid'
import { MockCeramicService, MockIpfsService } from '../../test-utils'
import { Connection } from 'typeorm'
import CID from 'cids'
import { Candidate } from '../../merkle/merkle-objects'
import { Anchor } from '../../models/anchor'
import { AnchorStatus } from '@ceramicnetwork/common'

process.env.NODE_ENV = 'test'

jest.mock('../blockchain/ethereum/ethereum-blockchain-service')

async function createRequest(streamId: string, ipfsService: IpfsService): Promise<Request> {
  const cid = await ipfsService.storeRecord({})
  const request = new Request()
  request.cid = cid.toString()
  request.streamId = streamId
  request.status = RequestStatus.PENDING
  request.message = 'Request is pending.'
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
    container.registerSingleton('blockchainService', EthereumBlockchainService)
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
    const sendTransaction = jest.fn()
    EthereumBlockchainService.prototype.sendTransaction = sendTransaction
    sendTransaction.mockImplementation(() => {
      throw new Error('Failed to send transaction!')
    })

    const streamId = await ceramicService.generateBaseStreamID()
    const cid = await ipfsService.storeRecord({})
    const streamCommitId = streamId.atCommit(cid)
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
    expect(request).toHaveProperty('status', RequestStatus.PROCESSING)

    const requests = await requestRepository.findNextToProcess()
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
      const commitId = streamId.atCommit(request.cid)
      const stream = createStream(streamId, [new CID(request.cid)])
      ceramicService.putStream(streamId, stream)
      ceramicService.putStream(commitId, stream)
    }
    requests.sort(function (a, b) {
      return a.streamId.localeCompare(b.streamId)
    })

    const candidates = await anchorService._findCandidates(requests, 0)
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
      const commitId = streamId.atCommit(request.cid)
      const stream = createStream(streamId, [new CID(request.cid)])
      ceramicService.putStream(streamId, stream)
      ceramicService.putStream(commitId, stream)
    }

    // First pass anchors half the pending requests
    let requests = await requestRepository.findNextToProcess()
    expect(requests.length).toEqual(numRequests)
    const anchorPendingRequests = async function (requests: Request[]): Promise<void> {
      const candidates = await anchorService._findCandidates(requests, anchorLimit)
      expect(candidates.length).toEqual(anchorLimit)

      await anchorCandidates(candidates, anchorService, ipfsService)
    }
    await anchorPendingRequests(requests)

    requests = await requestRepository.findNextToProcess()
    expect(requests.length).toEqual(numRequests / 2)

    // Second pass anchors the remaining half of the original requests
    await anchorPendingRequests(requests)

    // All requests should have been processed
    requests = await requestRepository.findNextToProcess()
    expect(requests.length).toEqual(0)
  })

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
      const commitId = streamId.atCommit(request.cid)
      const stream = createStream(streamId, [new CID(request.cid)])
      ceramicService.putStream(streamId, stream)
      ceramicService.putStream(commitId, stream)
    }

    let requests = await requestRepository.findNextToProcess()
    expect(requests.length).toEqual(numRequests)
    const candidates = await anchorService._findCandidates(requests, anchorLimit)
    expect(candidates.length).toEqual(numRequests)
    await anchorCandidates(candidates, anchorService, ipfsService)

    // All requests should have been processed
    requests = await requestRepository.findNextToProcess()
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
        const commitId = streamId.atCommit(request.cid)
        const stream = createStream(streamId, [new CID(request.cid)])
        ceramicService.putStream(streamId, stream)
        ceramicService.putStream(commitId, stream)
      }

      return request
    }

    // Create pending requests. 2 with valid streams on ceramic, 2 without
    const requests = await Promise.all([
      makeRequest(true),
      makeRequest(false),
      makeRequest(true),
      makeRequest(false),
    ])

    const candidates = await anchorService._findCandidates(requests, 0)
    expect(candidates.length).toEqual(2)

    const request0 = await requestRepository.findByCid(new CID(requests[0].cid))
    const request1 = await requestRepository.findByCid(new CID(requests[1].cid))
    const request2 = await requestRepository.findByCid(new CID(requests[2].cid))
    const request3 = await requestRepository.findByCid(new CID(requests[3].cid))
    expect(request0.status).toEqual(RequestStatus.PENDING)
    expect(request1.status).toEqual(RequestStatus.FAILED)
    expect(request2.status).toEqual(RequestStatus.PENDING)
    expect(request3.status).toEqual(RequestStatus.FAILED)
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
      const commitId0 = streamId.atCommit(request0.cid)
      const commitId1 = streamId.atCommit(request1.cid)

      // request1 is the most recent tip
      ceramicService.putStream(commitId0, createStream(streamId, [new CID(request0.cid)]))
      ceramicService.putStream(
        commitId1,
        createStream(streamId, [new CID(request0.cid), new CID(request1.cid)])
      )
      ceramicService.putStream(
        streamId,
        createStream(streamId, [new CID(request0.cid), new CID(request1.cid)])
      )

      const candidates = await anchorService._findCandidates([request0, request1], 0)
      const anchors = await anchorCandidates(candidates, anchorService, ipfsService)
      expect(candidates.length).toEqual(1)
      const candidate = candidates[0]
      expect(candidate.streamId).toEqual(streamId)
      expect(candidate.cid.toString()).toEqual(request1.cid)

      // Both requests should be marked as completed
      const updatedRequest0 = await requestRepository.findByCid(new CID(request0.cid))
      const updatedRequest1 = await requestRepository.findByCid(new CID(request1.cid))
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
      const commitId = streamId.atCommit(request.cid)
      const tipCID = await ipfsService.storeRecord({})

      // The most recent tip doesn't have a corresponding request, but includes the pending
      // request CID.
      ceramicService.putStream(commitId, createStream(streamId, [new CID(request.cid)]))
      ceramicService.putStream(streamId, createStream(streamId, [new CID(request.cid), tipCID]))

      const candidates = await anchorService._findCandidates([request], 0)
      const anchors = await anchorCandidates(candidates, anchorService, ipfsService)
      expect(candidates.length).toEqual(1)
      const candidate = candidates[0]
      expect(candidate.streamId).toEqual(streamId)
      expect(candidate.cid.toString()).toEqual(tipCID.toString())

      // request should be marked as completed
      const updatedRequest = await requestRepository.findByCid(new CID(request.cid))
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
      const commitId = streamId.atCommit(request.cid)
      const tipCID = await ipfsService.storeRecord({})

      // The most recent tip doesn't have a corresponding request, and does *not* include the pending
      // request CID.
      ceramicService.putStream(commitId, createStream(streamId, [new CID(request.cid)]))
      ceramicService.putStream(streamId, createStream(streamId, [tipCID]))

      const candidates = await anchorService._findCandidates([request], 0)
      expect(candidates.length).toEqual(0)
      const updatedRequest = await requestRepository.findByCid(new CID(request.cid))
      expect(updatedRequest.status).toEqual(RequestStatus.FAILED)
    })

    test('Request succeeds without anchor for already anchored CIDs', async () => {
      const requestRepository = container.resolve<RequestRepository>('requestRepository')
      const anchorService = container.resolve<AnchorService>('anchorService')

      const streamId = await ceramicService.generateBaseStreamID()
      const request = await createRequest(streamId.toString(), ipfsService)
      await requestRepository.createOrUpdate(request)
      const commitId = streamId.atCommit(request.cid)
      const anchorCommitCID = await ipfsService.storeRecord({})

      // The most recent tip doesn't have a corresponding request, but includes the pending
      // request CID.
      ceramicService.putStream(commitId, createStream(streamId, [new CID(request.cid)]))
      ceramicService.putStream(
        streamId,
        createStream(streamId, [new CID(request.cid), anchorCommitCID], AnchorStatus.ANCHORED)
      )

      const candidates = await anchorService._findCandidates([request], 0)
      expect(candidates.length).toEqual(0)

      // request should still be marked as completed even though no anchor was performed
      const updatedRequest = await requestRepository.findByCid(new CID(request.cid))
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
        const commitId = streamId.atCommit(request.cid)

        const stream = createStream(streamId, [new CID(request.cid)])
        ceramicService.putStream(commitId, stream)
        ceramicService.putStream(streamId, stream)
      }

      const candidates = await anchorService._findCandidates(requests, 0)
      await anchorCandidates(candidates, anchorService, ipfsService)
      expect(candidates.length).toEqual(numRequests)

      return requests
    }

    test('Successful anchor pins request', async () => {
      const requestRepository = container.resolve<RequestRepository>('requestRepository')

      const [request0] = await anchorRequests(1)

      // Request should be marked as completed and pinned
      const updatedRequest0 = await requestRepository.findByCid(new CID(request0.cid))
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
        requestCIDs.map((cid) => requestRepository.findByCid(new CID(cid)))
      )

      const now = new Date()
      const TWO_MONTHS = 1000 * 60 * 60 * 24 * 60
      const past = new Date(now.getTime() - TWO_MONTHS)

      // Make 2 of the 3 requests be expired
      requests[0].updatedAt = past
      requests[1].updatedAt = past
      await requestRepository.createOrUpdate(requests[0])
      await requestRepository.createOrUpdate(requests[1])

      // run garbage collection
      const unpinStreamSpy = jest.spyOn(ceramicService, 'unpinStream')
      await anchorService.garbageCollectPinnedStreams()

      const updatedRequests = await Promise.all(
        requests.map((req) => requestRepository.findByCid(new CID(req.cid)))
      )
      // Expired requests should be unpinned, but recent request should still be pinned
      expect(updatedRequests[0].pinned).toBeFalsy()
      expect(updatedRequests[1].pinned).toBeFalsy()
      expect(updatedRequests[2].pinned).toBeTruthy()
      expect(unpinStreamSpy).toHaveBeenCalledTimes(2)

      // Running garbage collection on already unpinned streams shouldn't unpin again
      updatedRequests[0].updatedAt = past
      await requestRepository.createOrUpdate(updatedRequests[0])
      await anchorService.garbageCollectPinnedStreams()

      const finalRequests = await Promise.all(
        updatedRequests.map((req) => requestRepository.findByCid(new CID(req.cid)))
      )
      expect(finalRequests[0].pinned).toBeFalsy()
      expect(finalRequests[1].pinned).toBeFalsy()
      expect(finalRequests[2].pinned).toBeTruthy()
      // No additional calls to unpinStream
      expect(unpinStreamSpy).toHaveBeenCalledTimes(2)
    })
  })
})
