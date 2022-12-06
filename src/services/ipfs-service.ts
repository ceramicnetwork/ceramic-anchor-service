import type { CID } from 'multiformats/cid'
import LRUCache from 'lru-cache'
import { create as createIpfsClient } from 'ipfs-http-client'
import { Config } from 'node-config-ts'
import { logger } from '../logger/index.js'
import * as dagJose from 'dag-jose'
import type { IPFS } from 'ipfs-core-types'
import { AnchorCommit, toCID } from '@ceramicnetwork/common'
import { StreamID } from '@ceramicnetwork/streamid'
import { Utils } from '../utils.js'
import * as http from 'http'
import * as https from 'https'
import { PubsubMessage } from '@ceramicnetwork/core'
import type { IpfsService } from './ipfs-service.type.js'

const { serialize, MsgType } = PubsubMessage

const DEFAULT_GET_TIMEOUT = 30000 // 30 seconds
const MAX_CACHE_ENTRIES = 100
const IPFS_PUT_TIMEOUT = 30 * 1000 // 30 seconds
const PUBSUB_DELAY = 100

const ipfsHttpAgent = (ipfsEndpoint: string) => {
  const agentOptions = {
    keepAlive: false,
    maxSockets: Infinity,
  }
  if (ipfsEndpoint.startsWith('https')) {
    return new https.Agent(agentOptions)
  } else {
    return new http.Agent(agentOptions)
  }
}

export class IpfsServiceImpl implements IpfsService {
  private readonly cache: LRUCache<string, any>
  private _ipfs: IPFS

  static inject = ['config'] as const

  constructor(private readonly config: Config) {
    this.cache = new LRUCache<string, any>({ max: MAX_CACHE_ENTRIES })
  }

  /**
   * Initialize the service
   */
  async init(): Promise<void> {
    this._ipfs = createIpfsClient({
      url: this.config.ipfsConfig.url,
      timeout: this.config.ipfsConfig.timeout,
      ipld: {
        codecs: [dagJose],
      },
      agent: ipfsHttpAgent(this.config.ipfsConfig.url),
    })

    // We have to subscribe to pubsub to keep ipfs connections alive.
    // TODO Remove this when the underlying ipfs issue is fixed
    await this._ipfs.pubsub.subscribe(this.config.ipfsConfig.pubsubTopic, () => {
      /* do nothing */
    })
  }

  /**
   * Gets the record by its CID value
   * @param cid - CID value
   */
  async retrieveRecord(cid: CID | string): Promise<any> {
    let retryTimes = 2
    while (retryTimes > 0) {
      try {
        let value = this.cache.get(cid.toString())
        if (value != null) {
          return value
        }
        const record = await this._ipfs.dag.get(toCID(cid), {
          timeout: DEFAULT_GET_TIMEOUT,
        })
        logger.debug('Successfully retrieved ' + cid)

        value = record.value
        this.cache.set(cid.toString(), value)
        return value
      } catch (e) {
        logger.err('Cannot retrieve IPFS record for CID ' + cid.toString())
        retryTimes--
      }
    }
    throw new Error('Failed to retrieve IPFS record for CID ' + cid.toString())
  }

  /**
   * Sets the record and returns its CID
   * @param record - Record value
   */
  async storeRecord(record: Record<string, unknown>): Promise<CID> {
    let timeout: any

    const putPromise = this._ipfs.dag.put(record).finally(() => {
      clearTimeout(timeout)
    })

    const timeoutPromise = new Promise((resolve) => {
      timeout = setTimeout(resolve, IPFS_PUT_TIMEOUT)
    })

    return await Promise.race([
      putPromise,
      timeoutPromise.then(() => {
        throw new Error(`Timed out storing record in IPFS`)
      }),
    ])
  }

  /**
   * Stores the anchor commit to ipfs and publishes an update pubsub message to the Ceramic pubsub topic
   * @param anchorCommit - anchor commit
   * @param streamId
   */
  async publishAnchorCommit(anchorCommit: AnchorCommit, streamId: StreamID): Promise<CID> {
    const anchorCid = await this.storeRecord(anchorCommit as any)

    const serializedMessage = serialize({
      typ: MsgType.UPDATE,
      stream: streamId,
      tip: anchorCid,
    })

    await this._ipfs.pubsub.publish(this.config.ipfsConfig.pubsubTopic, serializedMessage)

    // wait so that we don't flood the pubsub
    await Utils.delay(PUBSUB_DELAY)

    return anchorCid
  }
}
