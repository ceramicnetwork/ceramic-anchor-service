import CID from "cids";

import * as didJwt from 'did-jwt'

import { Resolver } from "did-resolver"

import CeramicClient from '@ceramicnetwork/http-client';
import KeyDidResolver from '@ceramicnetwork/key-did-resolver';
import ThreeIdResolver from '@ceramicnetwork/3id-did-resolver';
import { CeramicApi  } from "@ceramicnetwork/common";

import base64url from "base64url"

import { config } from "node-config-ts";
import { inject, singleton } from "tsyringe";
import BlockchainService from "./blockchain/blockchain-service";
import { IpfsService } from "./ipfs-service";

const DID_MATCHER = '^(did:([a-zA-Z0-9_]+):([a-zA-Z0-9_.-]+(:[a-zA-Z0-9_.-]+)*)((;[a-zA-Z0-9_.:%-]+=[a-zA-Z0-9_.:%-]*)*)(/[^#?]*)?)([?][^#]*)?(#.*)?';

@singleton()
export default class CeramicService {

  private readonly _client: CeramicApi;
  private readonly _resolver: Resolver;

  /**
   * Sets dependencies
   */
  constructor(@inject('ipfsService') private ipfsService?: IpfsService) {
    if (config.ceramic.validateRecords) {
      this._client = new CeramicClient(config.ceramic.apiUrl);

      const keyDidResolver = KeyDidResolver.getResolver();
      const threeIdResolver = ThreeIdResolver.getResolver(this._client);
      this._resolver = new Resolver({
        ...threeIdResolver, ...keyDidResolver,
      })
    }
  }

  /**
   * Verifies record signature
   * @param cid - CID of the record
   * @return DID
   * @private
   */
  async verifySignedRecord(cid: string | CID): Promise<string> {
    if (!config.ceramic.validateRecords) {
      return null; // return "empty" DID
    }

    try {
      const record = await this.ipfsService.retrieveRecord(cid);
      const { payload, signatures } = record;
      const { signature, protected: _protected } = signatures[0];

      const decodedHeader = JSON.parse(base64url.decode(_protected));
      const { kid } = decodedHeader;

      const didDoc = await this._resolver.resolve(kid);
      const jws = [_protected, payload, signature].join(".");
      await didJwt.verifyJWS(jws, didDoc.publicKey);
      return kid.match(RegExp(DID_MATCHER))[1];
    } catch (e) {
      throw new Error("Failed to verify record for " + cid.toString + ". " + e.message);
    }
  }

}
