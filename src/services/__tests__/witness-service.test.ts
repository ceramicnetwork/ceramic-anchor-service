import { beforeAll, describe, expect, test } from '@jest/globals'
import { RequestStatus } from '../../models/request.js'
import { Transaction } from '../../models/transaction.js'
import { verifyWitnessCAR, WitnessService } from '../witness-service.js'
import { FakeFactory } from './fake-factory.util.js'
import { RequestRepository } from '../../repositories/request-repository.js'
import { AnchorService } from '../anchor-service.js'
import { AnchorRepository } from '../../repositories/anchor-repository.js'
import { IIpfsService } from '../ipfs-service.type.js'
import { Knex } from 'knex'
import { createDbConnection } from '../../db-connection.js'
import { createInjector, Injector } from 'typed-inject'
import { config } from 'node-config-ts'
import { MetadataRepository } from '../../repositories/metadata-repository.js'
import { TransactionRepository } from '../../repositories/transaction-repository.js'
import { MockIpfsService } from '../../__tests__/test-utils.js'
import { IMetadataService, MetadataService } from '../metadata-service.js'
import { FakeEthereumBlockchainService } from './fake-ethereum-blockchain-service.util.js'
import { MockEventProducerService } from './mock-event-producer-service.util.js'
import { Request } from '../../models/request.js'
import { AnchorBatchSqsQueueService } from '../queue/sqs-queue-service.js'

const MERKLE_DEPTH_LIMIT = 3
const READY_RETRY_INTERVAL_MS = 1000
const STREAM_LIMIT = Math.pow(2, MERKLE_DEPTH_LIMIT)
const MIN_STREAM_COUNT = Math.floor(STREAM_LIMIT / 2)

type Context = {
  anchorRepository: AnchorRepository
  ipfsService: IIpfsService
  anchorService: AnchorService
  requestRepository: RequestRepository
  metadataService: IMetadataService
}

let connection: Knex
let fake: FakeFactory
let requestRepository: RequestRepository
let anchorService: AnchorService
let anchorRepository: AnchorRepository
let ipfsService: IIpfsService
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
    .provideClass('metadataRepository', MetadataRepository)
    .provideFactory('requestRepository', RequestRepository.make)
    .provideClass('transactionRepository', TransactionRepository)
    .provideClass('blockchainService', FakeEthereumBlockchainService)
    .provideClass('ipfsService', MockIpfsService)
    .provideClass('eventProducerService', MockEventProducerService)
    .provideClass('metadataService', MetadataService)
    .provideClass('anchorBatchQueueService', AnchorBatchSqsQueueService)
    .provideClass('anchorService', AnchorService)

  requestRepository = injector.resolve('requestRepository')
  anchorService = injector.resolve('anchorService')
  anchorRepository = injector.resolve('anchorRepository')
  ipfsService = injector.resolve('ipfsService')
  const metadataService = injector.resolve('metadataService')
  fake = new FakeFactory(ipfsService, metadataService, requestRepository)
})

describe('create witness CAR', () => {
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
  test('multiple anchors', async () => {
    const requests = await fake.multipleRequests(4, RequestStatus.PENDING)
    const { anchors, merkleTree } = await createAnchors(requests)

    const witnessService = new WitnessService()
    for (const freshAnchor of anchors) {
      const anchor = await anchorRepository.findByRequestId(freshAnchor.requestId)
      const witnessCAR = witnessService.buildWitnessCAR(anchor.cid, merkleTree.car)
      const anchorCommitCID = verifyWitnessCAR(witnessCAR)
      expect(anchorCommitCID).toBeTruthy()
      expect(anchorCommitCID.equals(anchor.cid)).toBeTruthy()
    }
  })

  test('single anchor', async () => {
    const request: Request = await fake.request(RequestStatus.PENDING)
    const { anchors, merkleTree } = await createAnchors([request])
    const witnessService = new WitnessService()
    for (const freshAnchor of anchors) {
      const anchor = await anchorRepository.findByRequestId(freshAnchor.requestId)
      const witnessCAR = witnessService.buildWitnessCAR(anchor.cid, merkleTree.car)
      const anchorCommitCID = verifyWitnessCAR(witnessCAR)
      expect(anchorCommitCID).toBeTruthy()
      expect(anchorCommitCID.equals(anchor.cid)).toBeTruthy()
    }
  })
})
