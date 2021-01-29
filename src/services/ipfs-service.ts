import CID from 'cids';

import LRUCache from "lru-cache"
import ipfsClient from "ipfs-http-client";
import { config } from "node-config-ts";

const DEFAULT_GET_TIMEOUT = 30000; // 30 seconds

import { logger } from '../logger';

// @ts-ignore
import dagJose from 'dag-jose'
// @ts-ignore
import multiformats from 'multiformats/basics'
// @ts-ignore
import legacy from 'multiformats/legacy'

// @ts-ignore
import type { IPFSAPI as IPFSApi } from 'ipfs-core/dist/src/components'

import { singleton } from "tsyringe";

const MAX_CACHE_ENTRIES = 100;

export interface IpfsService {
  /**
   * Initialize the service
   */
  init(): Promise<void>;

  /**
   * Gets the record by its CID value
   * @param cid - CID value
   */
  retrieveRecord(cid: CID | string): Promise<any>;

  /**
   * Sets the record and returns its CID
   * @param record - Record value
   */
  storeRecord(record: any): Promise<CID>;
}

@singleton()
export class IpfsServiceImpl implements IpfsService {

  private _ipfs: IPFSApi;
  private _cache: LRUCache;

  /**
   * Initialize the service
   */
  public async init(): Promise<void> {
    multiformats.multicodec.add(dagJose);
    const format = legacy(multiformats, dagJose.name);

    this._ipfs = ipfsClient({
      url: config.ipfsConfig.url,
      timeout: config.ipfsConfig.timeout,
      ipld: {
        formats: [format],
      },
    });

    this._cache = new LRUCache(MAX_CACHE_ENTRIES);
  }

  /**
   * Gets the record by its CID value
   * @param cid - CID value
   */
  public async retrieveRecord(cid: CID | string): Promise<any> {
    let retryTimes = 2;
    while (retryTimes > 0) {
      try {
        let value = this._cache.get(cid.toString());
        if (value != null) {
          return value;
        }
        const record = await this._ipfs.dag.get(cid, {
          timeout: DEFAULT_GET_TIMEOUT
        });
        logger.debug('Successfully retrieved ' + cid);

        value = record.value;
        this._cache.set(cid.toString(), value);
        return value;
      } catch (e) {
        logger.err('Cannot retrieve IPFS record for CID ' + cid.toString());
        retryTimes--
      }
    }
    throw new Error("Failed to retrieve IPFS record for CID " + cid.toString())
  }

  /**
   * Sets the record and returns its CID
   * @param record - Record value
   */
  public async storeRecord(record: Record<string, unknown>): Promise<CID> {
    return this._ipfs.dag.put(record);
  }
}
