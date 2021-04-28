import CeramicClient from '@ceramicnetwork/http-client';
import { CeramicApi, Stream, SyncOptions } from '@ceramicnetwork/common';

import { config } from "node-config-ts";
import { inject, singleton } from "tsyringe";
import { IpfsService } from "./ipfs-service";
import { StreamID, CommitID } from '@ceramicnetwork/streamid';

// Interface to allow injecting a mock in tests
export interface CeramicService {
  loadDocument(docId: StreamID): Promise<any>;
}

@singleton()
export default class CeramicServiceImpl implements CeramicService {

  private readonly _client: CeramicApi;

  /**
   * Sets dependencies
   */
  constructor(@inject('ipfsService') private ipfsService?: IpfsService) {
    this._client = new CeramicClient(config.ceramic.apiUrl);
  }

  async loadDocument<T extends Stream>(docId: StreamID | CommitID): Promise<T> {
    let timeout: any;

    const docPromise = this._client.loadStream(docId, {sync: SyncOptions.PREFER_CACHE})
      .finally(() => {
        clearTimeout(timeout);
      });

    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        reject(`Timed out loading docid: ${docId.toString()}`)
      }, 60 * 1000);
    });

    return (await Promise.race([docPromise, timeoutPromise])) as T
  }
}
