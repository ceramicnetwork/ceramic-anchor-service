import { beforeAll, describe, expect, test } from '@jest/globals'
import { RequestStatus } from '../../models/request.js'
import { Transaction } from '../../models/transaction.js'
import { IWitnessService, makeWitnessService } from '../witness-service.js'
import { FakeFactory } from './fake-factory.util.js'
import { RequestRepository } from '../../repositories/request-repository.js'
import { AnchorService } from '../anchor-service.js'
import { AnchorRepository } from '../../repositories/anchor-repository.js'
import { IIpfsService } from '../ipfs-service.type.js'
import { Knex } from 'knex'
import { createDbConnection } from '../../db-connection.js'
import { createInjector, Injector } from 'typed-inject'
import { config } from 'node-config-ts'
import { TransactionRepository } from '../../repositories/transaction-repository.js'
import { MockIpfsService } from '../../__tests__/test-utils.js'
import { FakeEthereumBlockchainService } from './fake-ethereum-blockchain-service.util.js'
import { MockEventProducerService } from './mock-event-producer-service.util.js'
import { Request } from '../../models/request.js'
import { AnchorBatchSqsQueueService } from '../queue/sqs-queue-service.js'
import { CAR, CARFactory } from 'cartonne'
import all from 'it-all'
import { makeMerkleCarService } from '../merkle-car-service.js'

const MERKLE_DEPTH_LIMIT = 3
const READY_RETRY_INTERVAL_MS = 1000
const STREAM_LIMIT = Math.pow(2, MERKLE_DEPTH_LIMIT)
const MIN_STREAM_COUNT = Math.floor(STREAM_LIMIT / 2)
const carFactory = new CARFactory()

type Context = {
  anchorRepository: AnchorRepository
  ipfsService: IIpfsService
  anchorService: AnchorService
  requestRepository: RequestRepository
  witnessService: IWitnessService
}

let connection: Knex
let fake: FakeFactory
let requestRepository: RequestRepository
let anchorService: AnchorService
let anchorRepository: AnchorRepository
let ipfsService: IIpfsService
let witnessService: IWitnessService
let injector: Injector<Context>

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
      })
    )
    .provideClass('anchorRepository', AnchorRepository)
    .provideFactory('requestRepository', RequestRepository.make)
    .provideClass('transactionRepository', TransactionRepository)
    .provideClass('blockchainService', FakeEthereumBlockchainService)
    .provideClass('ipfsService', MockIpfsService)
    .provideClass('eventProducerService', MockEventProducerService)
    .provideClass('anchorBatchQueueService', AnchorBatchSqsQueueService)
    .provideFactory('merkleCarService', makeMerkleCarService)
    .provideFactory('witnessService', makeWitnessService)
    .provideClass('anchorService', AnchorService)

  requestRepository = injector.resolve('requestRepository')
  anchorService = injector.resolve('anchorService')
  anchorRepository = injector.resolve('anchorRepository')
  ipfsService = injector.resolve('ipfsService')
  witnessService = injector.resolve('witnessService')
  fake = new FakeFactory(ipfsService, requestRepository)
})

async function createAnchors(requests: Array<Request>) {
  await requestRepository.findAndMarkReady(0)
  const [candidates] = await anchorService._findCandidates(requests, 0)
  const merkleTree = await anchorService._buildMerkleTree(candidates)
  const tx = new Transaction(
    'eip155:1',
    '0xc53b27bee6639dc498b88ce513d32df5f2f0bb7dd60aa15671f80cf341767ba3',
    3,
    3
  )
  const ipfsProofCid = await anchorService._createIPFSProof(
    merkleTree.car,
    tx,
    merkleTree.root.data.cid
  )
  const anchors = await anchorService._createAnchorCommits(ipfsProofCid, merkleTree)
  await anchorService._persistAnchorResult(anchors, candidates)
  return { anchors, merkleTree }
}

describe('create witness CAR', () => {
  test('multiple anchors', async () => {
    const requests = await fake.multipleRequests(4, RequestStatus.PENDING)
    const { anchors, merkleTree } = await createAnchors(requests)

    for (const freshAnchor of anchors) {
      const anchor = await anchorRepository.findByRequestId(freshAnchor.requestId)
      const witnessCAR = witnessService.build(anchor.cid, merkleTree.car)
      // CIDs that are part of witness
      const cidsInvolved = await all(witnessService.cids(witnessCAR)).then((cids) =>
        // `.slice` to remove the last element: a link to a `anchorCommit.prev`, which the CAR file does not have
        cids.map(String).slice(0, -1).sort()
      )
      // CIDs of CAR file blocks
      const cidsContained = await all(witnessCAR.blocks.cids()).then((cids) =>
        cids.map(String).sort()
      )
      // Should be the same
      expect(cidsContained).toEqual(cidsInvolved)
      const anchorCommitCID = witnessService.verify(witnessCAR)
      expect(anchorCommitCID).toBeTruthy()
      expect(anchorCommitCID.equals(anchor.cid)).toBeTruthy()
    }
  })

  test('single anchor', async () => {
    const request = await fake.request()
    const { anchors, merkleTree } = await createAnchors([request])
    for (const freshAnchor of anchors) {
      const anchor = await anchorRepository.findByRequestId(freshAnchor.requestId)
      const witnessCAR = witnessService.build(anchor.cid, merkleTree.car)
      const anchorCommitCID = witnessService.verify(witnessCAR)
      expect(anchorCommitCID).toBeTruthy()
      expect(anchorCommitCID.equals(anchor.cid)).toBeTruthy()
    }
  })
})

describe('verify witness', () => {
  test('no CAR roots', async () => {
    const request = await fake.request()
    const { anchors, merkleTree } = await createAnchors([request])
    const anchor = await anchorRepository.findByRequestId(anchors[0].requestId)
    const witnessCAR = witnessService.build(anchor.cid, merkleTree.car)
    const invalidCAR = new CAR(
      witnessCAR.version,
      [],
      witnessCAR.blocks,
      witnessCAR.codecs,
      witnessCAR.hashers
    )
    expect(() => witnessService.verify(invalidCAR)).toThrow(/No root found/)
  })
  test('no anchor commit', async () => {
    const request = await fake.request()
    const { anchors, merkleTree } = await createAnchors([request])
    const anchor = await anchorRepository.findByRequestId(anchors[0].requestId)
    const witnessCAR = witnessService.build(anchor.cid, merkleTree.car)
    const invalidCAR = carFactory.build()
    const anchorCommitCID = witnessCAR.roots[0]
    for (const block of Array.from(witnessCAR.blocks)) {
      if (!block.cid.equals(anchorCommitCID)) {
        invalidCAR.blocks.put(block)
      }
    }
    witnessCAR.roots.forEach((root) => invalidCAR.roots.push(root))
    expect(() => witnessService.verify(invalidCAR)).toThrow(/No anchor commit found/)
  })
  test('no proof', async () => {
    const request = await fake.request()
    const { anchors, merkleTree } = await createAnchors([request])
    const anchor = await anchorRepository.findByRequestId(anchors[0].requestId)
    const witnessCAR = witnessService.build(anchor.cid, merkleTree.car)
    const invalidCAR = carFactory.build()
    const anchorCommitCID = witnessCAR.roots[0]
    const proofCID = witnessCAR.get(anchorCommitCID).proof
    for (const block of Array.from(witnessCAR.blocks)) {
      if (!block.cid.equals(proofCID)) {
        invalidCAR.blocks.put(block)
      }
    }
    witnessCAR.roots.forEach((root) => invalidCAR.roots.push(root))
    expect(() => witnessService.verify(invalidCAR)).toThrow(/No proof found/)
  })
  test('no Merkle root', async () => {
    const request = await fake.request()
    const { anchors, merkleTree } = await createAnchors([request])
    const anchor = await anchorRepository.findByRequestId(anchors[0].requestId)
    const witnessCAR = witnessService.build(anchor.cid, merkleTree.car)
    const invalidCAR = carFactory.build()
    const anchorCommitCID = witnessCAR.roots[0]
    const proofCID = witnessCAR.get(anchorCommitCID).proof
    const merkleRootCID = witnessCAR.get(proofCID).root
    for (const block of Array.from(witnessCAR.blocks)) {
      if (!block.cid.equals(merkleRootCID)) {
        invalidCAR.blocks.put(block)
      }
    }
    witnessCAR.roots.forEach((root) => invalidCAR.roots.push(root))
    expect(() => witnessService.verify(invalidCAR)).toThrow(/No Merkle root found/)
  })
  test('missing witness node', async () => {
    const requests = await fake.multipleRequests(4)
    const { anchors, merkleTree } = await createAnchors(requests)
    const anchor = await anchorRepository.findByRequestId(anchors[0].requestId)
    const witnessCAR = witnessService.build(anchor.cid, merkleTree.car)
    const invalidCAR = carFactory.build()
    const anchorCommitCID = witnessCAR.roots[0]
    const proofCID = witnessCAR.get(anchorCommitCID).proof
    const merkleRootCID = witnessCAR.get(proofCID).root
    const left = witnessCAR.get(merkleRootCID)[0]
    for (const block of Array.from(witnessCAR.blocks)) {
      if (!block.cid.equals(left)) {
        invalidCAR.blocks.put(block)
      }
    }
    witnessCAR.roots.forEach((root) => invalidCAR.roots.push(root))
    expect(() => witnessService.verify(invalidCAR)).toThrow(/Missing witness node/)
  })
})
