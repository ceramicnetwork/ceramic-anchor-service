import type { CID } from 'multiformats/cid'
import LRUCache from 'lru-cache'
import { create as createIpfsClient } from 'ipfs-http-client'
import type { Config } from 'node-config-ts'
import { logger } from '../logger/index.js'
import type { IPFS } from 'ipfs-core-types'
import { AnchorCommit, toCID } from '@ceramicnetwork/common'
import type { StreamID } from '@ceramicnetwork/streamid'
import { Utils } from '../utils.js'
import * as http from 'http'
import * as https from 'https'
import { PubsubMessage } from '@ceramicnetwork/core'
import { ServiceMetrics as Metrics } from '@ceramicnetwork/observability'
import { METRIC_NAMES } from '../settings.js'
import type { IIpfsService, RetrieveRecordOptions } from './ipfs-service.type.js'
import type { AbortOptions } from './abort-options.type.js'
import { Semaphore } from 'await-semaphore'

const { serialize, MsgType } = PubsubMessage

export const IPFS_GET_RETRIES = 2
export const IPFS_GET_TIMEOUT = 30000 // 30 seconds
const MAX_CACHE_ENTRIES = 100
export const IPFS_PUT_TIMEOUT = 30 * 1000 // 30 seconds
const PUBSUB_DELAY = 100
const DEFAULT_CONCURRENT_GET_LIMIT = 100

function buildHttpAgent(endpoint: string | undefined): http.Agent {
  const agentOptions = {
    keepAlive: false,
    maxSockets: Infinity,
  }
  if (endpoint?.startsWith('https')) {
    return new https.Agent(agentOptions)
  } else {
    return new http.Agent(agentOptions)
  }
}

function buildIpfsClient(config: Config): IPFS {
  return createIpfsClient({
    url: config.ipfsConfig.url,
    timeout: config.ipfsConfig.timeout,
    agent: buildHttpAgent(config.ipfsConfig.url),
  })
}

export class IpfsService implements IIpfsService {
  private readonly cache: LRUCache<string, any>
  private readonly pubsubTopic: string
  private readonly ipfs: IPFS
  private readonly semaphore: Semaphore

  static inject = ['config'] as const

  constructor(config: Config, ipfs: IPFS = buildIpfsClient(config)) {
    this.cache = new LRUCache<string, any>({ max: MAX_CACHE_ENTRIES })
    this.ipfs = ipfs
    this.pubsubTopic = config.ipfsConfig.pubsubTopic
    const concurrentGetLimit = config.ipfsConfig.concurrentGetLimit || DEFAULT_CONCURRENT_GET_LIMIT
    this.semaphore = new Semaphore(concurrentGetLimit)
  }

  /**
   * Initialize the service
   */
  async init(): Promise<void> {
    // We have to subscribe to pubsub to keep ipfs connections alive.
    // TODO Remove this when the underlying ipfs issue is fixed
    await this.ipfs.pubsub.subscribe(this.pubsubTopic, () => {
      /* do nothing */
    })
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
        if (found) {
          return found
        }
        const record = await this.semaphore.use(async () => {
          return this.ipfs.dag.get(toCID(cid), {
            path: options.path,
            timeout: IPFS_GET_TIMEOUT,
            signal: options.signal,
          })
        })
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
   * Sets the record and returns its CID.
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
   * Stores `anchorCommit` to ipfs and publishes an update pubsub message to the Ceramic pubsub topic
   * @param anchorCommit - anchor commit
   * @param streamId
   * @param options
   */
  async publishAnchorCommit(
    anchorCommit: AnchorCommit,
    streamId: StreamID,
    options: AbortOptions = {}
  ): Promise<CID> {
    const anchorCid = await this.storeRecord(anchorCommit as any, { signal: options.signal })

    const serializedMessage = serialize({
      typ: MsgType.UPDATE,
      stream: streamId,
      tip: anchorCid,
    })

    await this.ipfs.pubsub.publish(this.pubsubTopic, serializedMessage, { signal: options.signal })

    // wait so that we don't flood the pubsub
    await Utils.delay(PUBSUB_DELAY)

    return anchorCid
  }
}
