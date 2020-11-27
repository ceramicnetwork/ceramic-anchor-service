import CID from 'cids';

import Contextual from "../contextual";

import ipfsClient from "ipfs-http-client";
import { config } from "node-config-ts";

import dagJose from 'dag-jose'
// @ts-ignore
import multiformats from 'multiformats/basics'
// @ts-ignore
import legacy from 'multiformats/legacy'

const DEFAULT_GET_TIMEOUT = 30000; // 10 seconds

import { Logger as logger } from '@overnightjs/logger';

import { Request } from "../models/request";

const MAX_FETCH_ITERATIONS = 10;
import { IPFSApi } from "../declarations";

export default class IpfsService implements Contextual {

  private _ipfs: IPFSApi;

  /**
   * Sets dependencies
   */
  setContext(): void {}

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

  public async tryToFetchByCIDs(requests: Array<Request>): Promise<Array<number>> {
    const objs = requests.map(r => {
      return { fails: 0, ok: false, r: r.id, cid: r.cid };
    });

    let start = 0;
    let oneFail = true;
    while (oneFail || start++ < MAX_FETCH_ITERATIONS) {
      oneFail = false;
      for (const obj of objs) {
        try {
          if (obj.ok) {
            continue;
          }
          await this.retrieveRecord(obj.cid);
          logger.Info("Found value for " + obj.cid);
          obj.ok = true;
        } catch (e) {
          logger.Err(obj.cid + " failed");
          oneFail = true;
          obj.fails = obj.fails + 1;
        }
      }
    }

    return objs.filter(o => !o.ok).map(o => o.r);
  }

  /**
   * Gets the record by its CID value
   * @param cid - CID value
   */
  public async retrieveRecord(cid: CID | string): Promise<any> {
    logger.Info("Retrieve record " + cid);

    const record = await this._ipfs.dag.get(cid, {
      timeout: DEFAULT_GET_TIMEOUT
    });
    return record.value;
  }

  /**
   * Sets the record and returns its CID
   * @param record - Record value
   */
  public async storeRecord(record: Record<string, unknown>): Promise<CID> {
    return this._ipfs.dag.put(record);
  }
}
