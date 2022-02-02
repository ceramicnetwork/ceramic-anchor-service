import type { CID } from 'multiformats/cid'
import LRUCache from 'lru-cache'
import { create as createIpfsClient } from 'ipfs-http-client'
import { Config } from 'node-config-ts'
import { logger } from '../logger/index.js'
import * as dagJose from 'dag-jose'
import type { IPFS } from 'ipfs-core-types'
import { inject, singleton } from 'tsyringe'
import { toCID } from '@ceramicnetwork/common'

const DEFAULT_GET_TIMEOUT = 30000 // 30 seconds
const MAX_CACHE_ENTRIES = 100
const IPFS_PUT_TIMEOUT = 30 * 1000 // 30 seconds

export interface IpfsService {
  /**
   * Initialize the service
   */
  init(): Promise<void>

  /**
   * Gets the record by its CID value
   * @param cid - CID value
   */
  retrieveRecord(cid: CID | string): Promise<any>

  /**
   * Sets the record and returns its CID
   * @param record - Record value
   */
  storeRecord(record: any): Promise<CID>
}

@singleton()
export class IpfsServiceImpl implements IpfsService {
  private _ipfs: IPFS
  private _cache: LRUCache

  constructor(@inject('config') private config?: Config) {}

  /**
   * Initialize the service
   */
  public async init(): Promise<void> {
    this._ipfs = createIpfsClient({
      url: this.config.ipfsConfig.url,
      timeout: this.config.ipfsConfig.timeout,
      ipld: {
        codecs: [dagJose],
      },
    })

    // We have to subscribe to pubsub to keep ipfs connections alive.
    // TODO Remove this when the underlying ipfs issue is fixed
    await this._ipfs.pubsub.subscribe(this.config.ipfsConfig.pubsubTopic, () => {
      /* do nothing */
    })

    this._cache = new LRUCache(MAX_CACHE_ENTRIES)
  }

  /**
   * Gets the record by its CID value
   * @param cid - CID value
   */
  public async retrieveRecord(cid: CID | string): Promise<any> {
    let retryTimes = 2
    while (retryTimes > 0) {
      try {
        let value = this._cache.get(cid.toString())
        if (value != null) {
          return value
        }
        const record = await this._ipfs.dag.get(toCID(cid), {
          timeout: DEFAULT_GET_TIMEOUT,
        })
        logger.debug('Successfully retrieved ' + cid)

        value = record.value
        this._cache.set(cid.toString(), value)
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
  public async storeRecord(record: Record<string, unknown>): Promise<CID> {
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
}
