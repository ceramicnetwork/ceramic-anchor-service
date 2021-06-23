import CeramicClient from '@ceramicnetwork/http-client';
import { CeramicApi, Stream, SyncOptions } from '@ceramicnetwork/common';

import { Config } from "node-config-ts";
import { inject, singleton } from "tsyringe";
import { IpfsService } from "./ipfs-service";
import { StreamID, CommitID } from '@ceramicnetwork/streamid';

// Interface to allow injecting a mock in tests
export interface CeramicService {
  loadStream(streamId: StreamID): Promise<any>;
}

@singleton()
export default class CeramicServiceImpl implements CeramicService {

  private readonly _client: CeramicApi;

  /**
   * Sets dependencies
   */
  constructor(@inject('config') private config?: Config,
              @inject('ipfsService') private ipfsService?: IpfsService) {
    this._client = new CeramicClient(config.ceramic.apiUrl);
  }

  async loadStream<T extends Stream>(streamId: StreamID | CommitID): Promise<T> {
    let timeout: any;

    const streamPromise = this._client.loadStream(streamId, {sync: SyncOptions.PREFER_CACHE})
      .finally(() => {
        clearTimeout(timeout);
      });

    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`Timed out loading stream: ${streamId.toString()}`))
      }, 60 * 1000);
    });

    return (await Promise.race([streamPromise, timeoutPromise])) as T
  }
}
