import CID from 'cids';

import ipfsClient from "ipfs-http-client";
import { config } from "node-config-ts";

const DEFAULT_GET_TIMEOUT = 30000; // 30 seconds

import { Logger as logger } from '@overnightjs/logger';

import { Request } from "../models/request";

// @ts-ignore
import dagJose from 'dag-jose'
// @ts-ignore
import multiformats from 'multiformats/basics'
// @ts-ignore
import legacy from 'multiformats/legacy'

// @ts-ignore
import type { IPFSAPI as IPFSApi } from 'ipfs-core/dist/src/components'

import { singleton } from "tsyringe";

export interface IpfsService {
  /**
   * Initialize the service
   */
  init(): Promise<void>;

  /**
   * Finds CIDs which cannot be fetched
   * @param requests - Request list
   */
  findUnreachableCids(requests: Array<Request>): Promise<Array<number>>;

  /**
   * Gets the record by its CID value
   * @param cid - CID value
   */
  retrieveRecord(cid: CID | string): Promise<any>;

  /**
   * Sets the record and returns its CID
   * @param record - Record value
   */
  storeRecord(record: Record<string, unknown>): Promise<CID>;
}

@singleton()
export class IpfsServiceImpl implements IpfsService {

  private _ipfs: IPFSApi;

  /**
   * Initialize the service
   */
  public async init(): Promise<void> {
    multiformats.multicodec.add(dagJose);
    const format = legacy(multiformats, dagJose.name);

    this._ipfs = ipfsClient({
      host: config.ipfsConfig.host,
      port: config.ipfsConfig.port,
      timeout: config.ipfsConfig.timeout,
      ipld: {
        formats: [format],
      },
    });
  }

  /**
   * Finds CIDs which cannot be fetched
   * @param requests - Request list
   */
  public async findUnreachableCids(requests: Array<Request>): Promise<Array<number>> {
    return (await Promise.all(requests.map(async (r) => {
      try {
        const record = await this.retrieveRecord(r.cid);
        if (record.link) {
          await this.retrieveRecord(record.link);
        }
        return null;
      } catch (e) {
        logger.Err('Failed to retrieve record. ' + e.message);
        return r.id;
      }
    }))).filter(id => id != null);
  }

  /**
   * Gets the record by its CID value
   * @param cid - CID value
   */
  public async retrieveRecord(cid: CID | string): Promise<any> {
    let retryTimes = 2;
    while (retryTimes > 0) {
      try {
        const record = await this._ipfs.dag.get(cid, {
          timeout: DEFAULT_GET_TIMEOUT
        });
        logger.Imp('Successfully retrieved ' + cid);
        return record.value;
      } catch (e) {
        logger.Err(e, true)
        retryTimes--
      }
    }
    throw new Error("Failed to retrieve record " + cid)
  }

  /**
   * Sets the record and returns its CID
   * @param record - Record value
   */
  public async storeRecord(record: Record<string, unknown>): Promise<CID> {
    return this._ipfs.dag.put(record);
  }
}
