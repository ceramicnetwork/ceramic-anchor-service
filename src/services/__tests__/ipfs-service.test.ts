import { jest, describe, test, expect, beforeEach, afterEach, beforeAll } from '@jest/globals'
import { type Config, config } from 'node-config-ts'
import {
  IPFS_GET_RETRIES,
  IPFS_GET_TIMEOUT,
  IPFS_PUT_TIMEOUT,
  IpfsService,
} from '../ipfs-service.js'
import { MockIpfsClient, randomCID, times } from '../../__tests__/test-utils.js'
import type { IpfsApi } from '@ceramicnetwork/common'
import type { AbortOptions } from '../abort-options.type.js'
import type { CID } from 'multiformats/cid'
import { DelayAbortedError, Utils } from '../../utils.js'
import { MetadataRepository } from '../../repositories/metadata-repository.js'
import { RequestRepository } from '../../repositories/request-repository.js'
import { AnchorRepository } from '../../repositories/anchor-repository.js'
import { createDbConnection } from '../../db-connection.js'
import { createInjector, type Injector } from 'typed-inject'
import { MockQueueService } from '../../__tests__/test-utils.js'
import { IpfsPubSubPublishQMessage } from '../../models/queue-message.js'
import type { Knex } from 'knex'
import { IQueueProducerService } from '../../services//queue/queue-service.type.js'
import type { Message, SignedMessage } from '@libp2p/interface-pubsub'
import { PubsubMessage } from '@ceramicnetwork/core'
import { type TypeOf } from 'codeco'
import { peerIdFromString } from '@libp2p/peer-id'
import * as random from '@stablelib/random'
import { randomStreamID, generateRequest } from '../../__tests__/test-utils.js'
import { RequestStatus } from '../../models/request.js'

const { serialize, deserialize, PubsubMessage: PubsubMessageCodec } = PubsubMessage
declare type PubsubMessage = TypeOf<typeof PubsubMessageCodec>

type Context = {
  config: Config
  anchorRepository: AnchorRepository
  metadataRepository: MetadataRepository
  ipfsQueueService: MockQueueService<IpfsPubSubPublishQMessage>
  requestRepository: RequestRepository
}

const RECORD = { hello: 'world' }

let mockIpfsClient: MockIpfsClient
let service: IpfsService
let connection: Knex
let injector: Injector<Context>

beforeAll(async () => {
  connection = await createDbConnection()
  injector = createInjector()
    .provideValue('dbConnection', connection)
    .provideValue(
      'config',
      Object.assign({}, config, {
        ipfsConfig: {
          pubsubTopic: '/faux',
          concurrentGetLimit: 100,
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
    .provideClass('ipfsQueueService', MockQueueService<IpfsPubSubPublishQMessage>)
})

beforeEach(async () => {
  mockIpfsClient = new MockIpfsClient()

  const config = injector.resolve('config')
  const ipfsQueueService = injector.resolve('ipfsQueueService')
  const requestRepository = injector.resolve('requestRepository')
  const anchorRepository = injector.resolve('anchorRepository')

  service = new IpfsService(
    config,
    ipfsQueueService as IQueueProducerService<IpfsPubSubPublishQMessage>,
    requestRepository,
    anchorRepository,
    mockIpfsClient as unknown as IpfsApi
  )
})

afterEach(() => {
  jest.resetAllMocks()
})

describe('storeRecord', () => {
  test('store IPFS record', async () => {
    const dagPutSpy = jest.spyOn(mockIpfsClient.dag, 'put')
    await service.storeRecord(RECORD)
    expect(dagPutSpy).toBeCalledWith(RECORD, { timeout: IPFS_PUT_TIMEOUT })
  })
  test('pass AbortSignal', async () => {
    const dagPutSpy = jest.spyOn(mockIpfsClient.dag, 'put')
    const abortController = new AbortController()
    await service.storeRecord(RECORD, { signal: abortController.signal })
    expect(dagPutSpy).toBeCalledWith(RECORD, {
      signal: abortController.signal,
      timeout: IPFS_PUT_TIMEOUT,
    })
  })

  test('pin records', async () => {
    const dagPutSpy = jest.spyOn(mockIpfsClient.dag, 'put')
    const pinAddSpy = jest.spyOn(mockIpfsClient.pin, 'add')
    const cid = await service.storeRecord({})
    expect(dagPutSpy).toBeCalledTimes(1)
    expect(pinAddSpy).toBeCalledTimes(1)
    expect(pinAddSpy).toBeCalledWith(cid, {
      signal: undefined,
      timeout: IPFS_PUT_TIMEOUT,
      recursive: false,
    })
  })
})

describe('retrieveRecord', () => {
  test('cache record', async () => {
    const cid = await service.storeRecord(RECORD)
    const dagGetSpy = jest.spyOn(mockIpfsClient.dag, 'get')
    expect(dagGetSpy).toBeCalledTimes(0)
    await service.retrieveRecord(cid) // Call ipfs.dag.get
    expect(dagGetSpy).toBeCalledTimes(1)
    dagGetSpy.mockClear()
    await service.retrieveRecord(cid) // Use cached value. Do not use ipfs.dag.get
    expect(dagGetSpy).toBeCalledTimes(0)
  })
  test('cache record if path provided', async () => {
    const cid = await service.storeRecord(RECORD)
    const dagGetSpy = jest.spyOn(mockIpfsClient.dag, 'get')
    expect(dagGetSpy).toBeCalledTimes(0)
    await service.retrieveRecord(cid, { path: '/link' }) // Call ipfs.dag.get
    expect(dagGetSpy).toBeCalledTimes(1)
    dagGetSpy.mockClear()
    await service.retrieveRecord(cid, { path: '/link' }) // Use cached value. Do not use ipfs.dag.get
    expect(dagGetSpy).toBeCalledTimes(0)
    dagGetSpy.mockClear()
    await service.retrieveRecord(cid) // Without `path` it is a different value. Retrieve from ipfs.dag.get.
    expect(dagGetSpy).toBeCalledTimes(1)
  })
  test('retry', async () => {
    const cid = await service.storeRecord(RECORD)
    const dagGetSpy = jest.spyOn(mockIpfsClient.dag, 'get')
    times(IPFS_GET_RETRIES - 1).forEach(() => {
      dagGetSpy.mockImplementationOnce(() => Promise.reject(new Error(`Nope`)))
    })
    await service.retrieveRecord(cid)
    expect(dagGetSpy).toBeCalledTimes(IPFS_GET_RETRIES)
    for (const i of times(IPFS_GET_RETRIES)) {
      expect(dagGetSpy.mock.calls[i]).toEqual([cid, { timeout: IPFS_GET_TIMEOUT }])
    }
  })
  test('retry: fail if attempts are exhausted', async () => {
    const cid = await service.storeRecord(RECORD)
    const dagGetSpy = jest.spyOn(mockIpfsClient.dag, 'get')
    times(IPFS_GET_RETRIES).forEach(() => {
      dagGetSpy.mockImplementationOnce(() => Promise.reject(new Error(`Nope`)))
    })
    await expect(service.retrieveRecord(cid)).rejects.toThrow(
      /Failed to retrieve IPFS record for CID/
    )
  })
  test('accept AbortSignal', async () => {
    const abortController = new AbortController()
    const cid = await service.storeRecord(RECORD)
    const dagGetSpy = jest.spyOn(mockIpfsClient.dag, 'get')
    // Simulate ipfs.dag.get call that throws when aborted
    times(IPFS_GET_RETRIES - 1).forEach(() => {
      dagGetSpy.mockImplementationOnce(async (cid: CID, options: AbortOptions = {}) => {
        await Utils.delay(10000, options.signal)
      })
    })
    const retrieveRecordP = service.retrieveRecord(cid, { signal: abortController.signal })
    abortController.abort()

    // Do not retry if an exception is due to AbortSignal
    await expect(retrieveRecordP).rejects.toThrow(DelayAbortedError)

    // Delay is huge, so ipfs.dag.get is called just once
    expect(dagGetSpy).toBeCalledTimes(1)
    // Pass original AbortSignal to ipfs.dag.get
    expect(dagGetSpy).toBeCalledWith(cid, {
      timeout: IPFS_GET_TIMEOUT,
      signal: abortController.signal,
    })
  })
})

export function asIpfsMessage(data: Uint8Array): SignedMessage {
  return {
    type: 'signed',
    from: peerIdFromString('QmQSzwPncmYm8sfgZg5Fz29YFzB6fRFBtGHqWPCDjrMLfV'),
    topic: 'topic',
    data: data,
    sequenceNumber: BigInt(random.randomUint32()),
    signature: random.randomBytes(10),
    key: random.randomBytes(10),
  }
}

describe('pubsub', () => {
  test('Will ignore non query pubsub messages', async () => {
    const pubsubMessage = { typ: 3, ts: random.randomUint32(), ver: '2.39.0-rc.1' }

    const ipfsQueueService = injector.resolve('ipfsQueueService')
    const queueSendMessageSpy = jest.spyOn(ipfsQueueService, 'sendMessage')
    const handleMessageSpy = jest.spyOn(service, 'handleMessage')
    const pubsubSubscribeSpy = jest.spyOn(mockIpfsClient.pubsub, 'subscribe')
    pubsubSubscribeSpy.mockImplementationOnce(
      (topic: string, onMessage: (message: Message) => void) => {
        expect(topic).toEqual('/faux')
        onMessage(asIpfsMessage(serialize(pubsubMessage)))
        return Promise.resolve()
      }
    )

    // @ts-ignore
    service.respondToPubsubQueries = true
    await service.init()

    await Utils.delay(1000)
    expect(handleMessageSpy).toBeCalledTimes(1)
    expect(handleMessageSpy).toBeCalledWith(pubsubMessage)
    expect(queueSendMessageSpy).toBeCalledTimes(0)
  })

  test('Will not respond to query message about stream without any anchors', async () => {
    const pubsubMessage = { typ: 1, id: '1', stream: randomStreamID() }

    const ipfsQueueService = injector.resolve('ipfsQueueService')
    const queueSendMessageSpy = jest.spyOn(ipfsQueueService, 'sendMessage')
    const handleMessageSpy = jest.spyOn(service, 'handleMessage')
    const pubsubSubscribeSpy = jest.spyOn(mockIpfsClient.pubsub, 'subscribe')
    pubsubSubscribeSpy.mockImplementationOnce(
      (topic: string, onMessage: (message: Message) => void) => {
        expect(topic).toEqual('/faux')
        onMessage(asIpfsMessage(serialize(pubsubMessage)))
        return Promise.resolve()
      }
    )

    // @ts-ignore
    service.respondToPubsubQueries = true
    await service.init()

    await Utils.delay(1000)
    expect(handleMessageSpy).toBeCalledTimes(1)
    expect(handleMessageSpy).toBeCalledWith(pubsubMessage)
    expect(queueSendMessageSpy).toBeCalledTimes(0)
  })

  test('Will respond to query message about stream with an anchor', async () => {
    const pubsubMessage = { typ: 1, id: '1', stream: randomStreamID() }

    const ipfsQueueService = injector.resolve('ipfsQueueService')
    const queueSendMessageSpy = jest.spyOn(ipfsQueueService, 'sendMessage')
    const handleMessageSpy = jest.spyOn(service, 'handleMessage')
    const pubsubSubscribeSpy = jest.spyOn(mockIpfsClient.pubsub, 'subscribe')
    pubsubSubscribeSpy.mockImplementationOnce(
      (topic: string, onMessage: (message: Message) => void) => {
        expect(topic).toEqual('/faux')
        onMessage(asIpfsMessage(serialize(pubsubMessage)))
        return Promise.resolve()
      }
    )
    const requestRepository = injector.resolve('requestRepository')
    const createdRequest = await requestRepository.create(
      generateRequest({
        streamId: pubsubMessage.stream.toString(),
        status: RequestStatus.COMPLETED,
      })
    )
    if (!createdRequest) {
      throw new Error('Failed to create request because it already exists')
    }
    const anchorRepository = injector.resolve('anchorRepository')
    const anchorCid = randomCID()
    await anchorRepository.createAnchors([
      {
        requestId: createdRequest.id,
        proofCid: randomCID(),
        path: '0',
        cid: anchorCid,
      },
    ])

    // @ts-ignore
    service.respondToPubsubQueries = true
    await service.init()

    await Utils.delay(1000)
    expect(handleMessageSpy).toBeCalledTimes(1)
    expect(handleMessageSpy).toBeCalledWith(pubsubMessage)
    expect(queueSendMessageSpy).toBeCalledTimes(1)
    const receivedQueueMessage = queueSendMessageSpy.mock.calls[0][0] as any
    const deserialized = deserialize({ data: Uint8Array.from(receivedQueueMessage.data) }) as any
    expect(deserialized.typ).toEqual(2)
    const receivedTips = deserialized.tips
    expect(receivedTips.size).toEqual(1)
    const receivedTip = deserialized.tips.get(pubsubMessage.stream.toString()).toString()
    expect(receivedTip).toEqual(anchorCid.toString())
  })

  test('Will not respond to query message about stream with an anchor if it is too old', async () => {
    const pubsubMessage = { typ: 1, id: '1', stream: randomStreamID() }

    const ipfsQueueService = injector.resolve('ipfsQueueService')
    const queueSendMessageSpy = jest.spyOn(ipfsQueueService, 'sendMessage')
    const handleMessageSpy = jest.spyOn(service, 'handleMessage')
    const pubsubSubscribeSpy = jest.spyOn(mockIpfsClient.pubsub, 'subscribe')
    pubsubSubscribeSpy.mockImplementationOnce(
      (topic: string, onMessage: (message: Message) => void) => {
        expect(topic).toEqual('/faux')
        onMessage(asIpfsMessage(serialize(pubsubMessage)))
        return Promise.resolve()
      }
    )
    // @ts-ignore
    const beforeWindow = new Date(Date.now() - service.pubsubResponderWindowMs - 1000)
    const requestRepository = injector.resolve('requestRepository')
    const createdRequest = await requestRepository.create(
      generateRequest({
        streamId: pubsubMessage.stream.toString(),
        status: RequestStatus.COMPLETED,
        // @ts-ignore
        createdAt: beforeWindow,
        updatedAt: beforeWindow,
      })
    )
    if (!createdRequest) {
      throw new Error('Failed to create request because it already exists')
    }
    const anchorRepository = injector.resolve('anchorRepository')
    const anchorCid = randomCID()
    await anchorRepository.createAnchors([
      {
        requestId: createdRequest.id,
        proofCid: randomCID(),
        path: '0',
        cid: anchorCid,
      },
    ])

    // @ts-ignore
    service.respondToPubsubQueries = true
    await service.init()

    await Utils.delay(1000)
    expect(handleMessageSpy).toBeCalledTimes(1)
    expect(handleMessageSpy).toBeCalledWith(pubsubMessage)
    expect(queueSendMessageSpy).toBeCalledTimes(0)
  })

  test('Will ignore non pusub messages', async () => {
    const pubsubMessage = { typ: 1, id: '1', stream: randomStreamID() }

    const ipfsQueueService = injector.resolve('ipfsQueueService')
    const queueSendMessageSpy = jest.spyOn(ipfsQueueService, 'sendMessage')
    const handleMessageSpy = jest.spyOn(service, 'handleMessage')
    const pubsubSubscribeSpy = jest.spyOn(mockIpfsClient.pubsub, 'subscribe')
    pubsubSubscribeSpy.mockImplementationOnce(
      (topic: string, onMessage: (message: Message) => void) => {
        expect(topic).toEqual('/faux')
        onMessage(asIpfsMessage(Buffer.from('stuff', 'base64')))
        onMessage(asIpfsMessage(serialize(pubsubMessage)))
        return Promise.resolve()
      }
    )

    // @ts-ignore
    service.respondToPubsubQueries = true
    await service.init()

    await Utils.delay(1000)
    expect(handleMessageSpy).toBeCalledTimes(1)
    expect(handleMessageSpy).toBeCalledWith(pubsubMessage)
    expect(queueSendMessageSpy).toBeCalledTimes(0)
  })

  test('Will resubscribe if error received from pubsub subscription', async () => {
    const pubsubMessage = { typ: 1, id: '1', stream: randomStreamID() }

    const ipfsQueueService = injector.resolve('ipfsQueueService')
    const queueSendMessageSpy = jest.spyOn(ipfsQueueService, 'sendMessage')
    const handleMessageSpy = jest.spyOn(service, 'handleMessage')
    const pubsubSubscribeSpy = jest.spyOn(mockIpfsClient.pubsub, 'subscribe')
    pubsubSubscribeSpy
      .mockImplementationOnce(
        (
          topic: string,
          onMessage: (message: Message) => void,
          options?: { onError?: (err: Error) => void }
        ) => {
          expect(topic).toEqual('/faux')
          if (options?.onError) {
            options.onError(new Error('test'))
          }
          return Promise.resolve()
        }
      )
      .mockImplementationOnce((topic: string, onMessage: (message: Message) => void) => {
        onMessage(asIpfsMessage(serialize(pubsubMessage)))
        return Promise.resolve()
      })

    // @ts-ignore
    service.respondToPubsubQueries = true
    // @ts-ignore
    service.resubscribeAfterErrorDelay = 500
    await service.init()

    await Utils.delay(1000)
    expect(handleMessageSpy).toBeCalledTimes(1)
    expect(queueSendMessageSpy).toBeCalledTimes(0)
  })
})
