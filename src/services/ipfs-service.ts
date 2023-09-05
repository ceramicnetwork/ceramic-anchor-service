import type { CID } from 'multiformats/cid'
import { LRUCache } from 'least-recent'
import { create as createIpfsClient } from 'ipfs-http-client'
import type { Config } from 'node-config-ts'
import { logger } from '../logger/index.js'
import { toCID, IpfsApi } from '@ceramicnetwork/common'
import type { StreamID } from '@ceramicnetwork/streamid'
import { Utils } from '../utils.js'
import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { PubsubMessage } from '@ceramicnetwork/core'
import { ServiceMetrics as Metrics } from '@ceramicnetwork/observability'
import { METRIC_NAMES } from '../settings.js'
import type { IIpfsService, RetrieveRecordOptions } from './ipfs-service.type.js'
import type { AbortOptions } from './abort-options.type.js'
import { Semaphore } from 'await-semaphore'
import type { CAR } from 'cartonne'
import all from 'it-all'
import { Observable, map, filter, catchError, of, mergeMap, EMPTY, Subscription, retry } from 'rxjs'
import type { Message } from '@libp2p/interface-pubsub'
import { type TypeOf } from 'codeco'
import { IQueueProducerService } from './queue/queue-service.type.js'
import { IpfsPubSubPublishQMessage } from '../models/queue-message.js'
import { type Request } from '../models/request.js'
import type { RequestRepository } from '../repositories/request-repository.js'
import type { IAnchorRepository } from '../repositories/anchor-repository.type.js'
import { AppMode } from '../app-mode.js'

const { serialize, MsgType, deserialize, PubsubMessage: PubsubMessageCodec } = PubsubMessage
declare type PubsubMessage = TypeOf<typeof PubsubMessageCodec>

export const IPFS_GET_RETRIES = 2
export const IPFS_GET_TIMEOUT = 30000 // 30 seconds
const IPFS_RESUBSCRIBE_AFTER_ERROR_DELAY = 1000 * 15 // 15 sec
const MAX_CACHE_ENTRIES = 100
export const IPFS_PUT_TIMEOUT = 30 * 1000 // 30 seconds
const PUBSUB_DELAY = 100
const DEFAULT_CONCURRENT_GET_LIMIT = 100

function buildHttpAgent(endpoint: string | undefined): HttpAgent {
  const agentOptions = {
    keepAlive: false,
    maxSockets: Infinity,
  }
  if (endpoint?.startsWith('https')) {
    return new HttpsAgent(agentOptions)
  } else {
    return new HttpAgent(agentOptions)
  }
}

function buildIpfsClient(config: Config): IpfsApi {
  return createIpfsClient({
    url: config.ipfsConfig.url,
    timeout: config.ipfsConfig.timeout,
    agent: buildHttpAgent(config.ipfsConfig.url),
  })
}

export class IpfsService implements IIpfsService {
  private readonly cache: LRUCache<string, any>
  private readonly pubsubTopic: string
  private readonly ipfs: IpfsApi
  private readonly semaphore: Semaphore
  private readonly hasherNames: Map<number, string>
  private readonly codecNames: Map<number, string>
  private pubsub$?: Subscription
  private readonly respondToPubsubQueries: boolean
  private readonly resubscribeAfterErrorDelay: number

  static inject = ['config', 'ipfsQueueService', 'requestRepository', 'anchorRepository'] as const

  constructor(
    config: Config,
    private readonly ipfsQueueService: IQueueProducerService<IpfsPubSubPublishQMessage>,
    private readonly requestRepository: RequestRepository,
    private readonly anchorRepository: IAnchorRepository,
    ipfs: IpfsApi = buildIpfsClient(config)
  ) {
    this.cache = new LRUCache<string, any>(MAX_CACHE_ENTRIES)
    this.ipfs = ipfs
    this.pubsubTopic = config.ipfsConfig.pubsubTopic
    const concurrentGetLimit = config.ipfsConfig.concurrentGetLimit || DEFAULT_CONCURRENT_GET_LIMIT
    this.semaphore = new Semaphore(concurrentGetLimit)
    this.hasherNames = new Map()
    this.codecNames = new Map()
    this.respondToPubsubQueries = config.mode === AppMode.PUBSUB_RESPONDER ? true : false
    this.resubscribeAfterErrorDelay = IPFS_RESUBSCRIBE_AFTER_ERROR_DELAY
  }

  /**
   * Initialize the service
   */
  async init(): Promise<void> {
    for (const codec of this.ipfs.codecs.listCodecs()) {
      this.codecNames.set(codec.code, codec.name)
    }
    for (const hasher of this.ipfs.hashers.listHashers()) {
      this.hasherNames.set(hasher.code, hasher.name)
    }

    await this.createPubsub()
  }

  /**
   * Gets the record by its CID value
   * @param cid - CID value
   * @param options - May contain AbortSignal
   */
  async retrieveRecord<T = any>(
    cid: CID | string,
    options: RetrieveRecordOptions = {}
  ): Promise<T> {
    const cacheKey = `${cid}${options.path || ''}`
    let retryTimes = IPFS_GET_RETRIES
    while (retryTimes > 0) {
      try {
        const found = this.cache.get(cacheKey)
        if (found) return found
        const record = await this.semaphore.use(() =>
          this.ipfs.dag.get(toCID(cid), {
            path: options.path,
            timeout: IPFS_GET_TIMEOUT,
            signal: options.signal,
          })
        )
        const value = record.value
        Metrics.count(METRIC_NAMES.IPFS_GET_SUCCEEDED, 1)
        logger.debug(`Successfully retrieved ${cacheKey}`)
        this.cache.set(cacheKey, value)
        return value as T
      } catch (e) {
        if (options.signal?.aborted) throw e
        logger.err(`Cannot retrieve IPFS record for CID ${cacheKey}`)
        retryTimes--
      }
    }
    Metrics.count(METRIC_NAMES.IPFS_GET_FAILED, 1)
    throw new Error(`Failed to retrieve IPFS record for CID ${cacheKey}`)
  }

  /**
   * Store the record and return its CID.
   *
   * The record will also be pinned non-recusively.
   */
  async storeRecord(record: Record<string, unknown>, options: AbortOptions = {}): Promise<CID> {
    const cid = await this.ipfs.dag.put(record, {
      signal: options.signal,
      timeout: IPFS_PUT_TIMEOUT,
    })
    // Note: While dag.put has a pin flag it always recurses and
    // we do not want to recurse so we explicitly call pin.add.
    await this.ipfs.pin.add(cid, {
      signal: options.signal,
      timeout: IPFS_PUT_TIMEOUT,
      recursive: false,
    })
    return cid
  }

  /**
   * Publish an UPDATE pubsub message to the Ceramic pubsub topic.
   *
   * @param anchorCID - CID of anchor commit
   * @param streamId
   * @param options
   */
  async publishAnchorCommit(
    anchorCID: CID,
    streamId: StreamID,
    options: AbortOptions = {}
  ): Promise<void> {
    const serializedMessage = serialize({
      typ: MsgType.UPDATE,
      stream: streamId,
      tip: anchorCID,
    })

    await this.ipfs.pubsub.publish(this.pubsubTopic, serializedMessage, { signal: options.signal })

    // wait so that we don't flood the pubsub
    await Utils.delay(PUBSUB_DELAY)
  }

  async importCAR(car: CAR, options: AbortOptions = {}): Promise<void> {
    await all(this.ipfs.dag.import(car, { pinRoots: false }))
    for (const cid of car.blocks.cids()) {
      await this.ipfs.pin.add(cid, {
        signal: options.signal,
        timeout: IPFS_PUT_TIMEOUT,
        recursive: false,
      })
    }
  }

  async stop(): Promise<void> {
    if (this.pubsub$) {
      this.pubsub$.unsubscribe()
    }

    await this.ipfs.pubsub.unsubscribe(this.pubsubTopic)
  }

  private async createPubsub() {
    if (this.respondToPubsubQueries) {
      const ipfsId = await this.ipfs.id()
      this.pubsub$ = new Observable<Message>((subscriber) => {
        const onMessage = (message: Message) => subscriber.next(message)
        const onError = (error: Error) => subscriber.error(error)
        this.ipfs.pubsub
          .subscribe(this.pubsubTopic, onMessage, { onError })
          .then(() => {
            logger.debug(`successfully subscribed to topic ${this.pubsubTopic}`)
          })
          .catch(onError)
      })
        .pipe(
          filter(
            (message: Message) =>
              message.type === 'signed' && message.from.toString() !== ipfsId.id.toString()
          ),
          mergeMap((incoming) =>
            of(incoming).pipe(
              map((incoming) => deserialize(incoming)),
              catchError(() => EMPTY)
            )
          ),
          catchError((err) => {
            logger.err(
              `Received error from pubsub subscription for topic ${this.pubsubTopic}: ${err}`
            )
            throw err
          }),
          retry({
            delay: this.resubscribeAfterErrorDelay,
          })
        )
        .subscribe(this.handleMessage.bind(this))
    } else {
      // We have to subscribe to pubsub to keep ipfs connections alive.
      // TODO Remove this when the underlying ipfs issue is fixed
      await this.ipfs.pubsub.subscribe(this.pubsubTopic, () => {
        /* do nothing */
      })
    }
  }

  async handleMessage(message: PubsubMessage): Promise<void> {
    if (message.typ === MsgType.QUERY) {
      const { stream: streamId, id } = message

      const completedRequest = await this.requestRepository.findCompletedForStream(streamId, 1)
      if (completedRequest.length === 0) {
        return
      }
      const anchor = await this.anchorRepository.findByRequest(completedRequest[0] as Request)
      if (!anchor) {
        logger.err(`Could not find anchor for completed request ${completedRequest}`)
        return
      }

      const tipMap = new Map().set(streamId.toString(), anchor.cid)

      const serializedMessage = serialize({ typ: MsgType.RESPONSE, id, tips: tipMap })

      const ipfsQueueMessage = {
        createdAt: new Date(),
        topic: this.pubsubTopic,
        data: Array.from(serializedMessage),
        timeoutMs: undefined,
      }
      await this.ipfsQueueService.sendMessage(ipfsQueueMessage)
    }
  }
}
