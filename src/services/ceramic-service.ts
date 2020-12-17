import { Resolver } from "did-resolver"

import CeramicClient from '@ceramicnetwork/http-client';
import { CeramicApi, Doctype } from '@ceramicnetwork/common';

import { config } from "node-config-ts";
import { inject, singleton } from "tsyringe";
import { IpfsService } from "./ipfs-service";
import DocID from '@ceramicnetwork/docid';

// Interface to allow injecting a mock in tests
export interface CeramicService {
  loadDocument(docId: DocID): Promise<any>;
}

@singleton()
export default class CeramicServiceImpl implements CeramicService {

  private readonly _client: CeramicApi;
  private readonly _resolver: Resolver;

  /**
   * Sets dependencies
   */
  constructor(@inject('ipfsService') private ipfsService?: IpfsService) {
    this._client = new CeramicClient(config.ceramic.apiUrl);
  }

  async loadDocument<T extends Doctype>(docId: DocID): Promise<T> {
    return await this._client.loadDocument(docId, {sync: false})
  }

}
