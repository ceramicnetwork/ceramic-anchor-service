import * as didJwt from 'did-jwt'

import { Resolver } from "did-resolver"

import CeramicClient from '@ceramicnetwork/http-client';
import KeyDidResolver from '@ceramicnetwork/key-did-resolver';
import ThreeIdResolver from '@ceramicnetwork/3id-did-resolver';
import { CeramicApi  } from "@ceramicnetwork/common";

import Contextual from "../contextual";

import base64url from "base64url"

import { config } from "node-config-ts";

const DID_MATCHER = '^(did:([a-zA-Z0-9_]+):([a-zA-Z0-9_.-]+(:[a-zA-Z0-9_.-]+)*)((;[a-zA-Z0-9_.:%-]+=[a-zA-Z0-9_.:%-]*)*)(/[^#?]*)?)([?][^#]*)?(#.*)?';

export default class CeramicService implements Contextual {

  private _client: CeramicApi;
  private _resolver: Resolver;
  private _validateRecords: boolean;

  /**
   * Sets dependencies
   */
  setContext(): void {
    this._validateRecords = config.ceramic.validateRecords;
    if (typeof this._validateRecords === "string") {
      this._validateRecords = this._validateRecords as string === 'true'
    }

    if (this._validateRecords) {
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
   * @param record - Record data
   * @return DID
   * @private
   */
  async verifySignedRecord(record: Record<string, unknown>): Promise<string> {
    if (this._validateRecords) {
      const { payload, signatures } = record;
      const { signature, protected: _protected } = signatures[0];

      const decodedHeader = JSON.parse(base64url.decode(_protected));
      const { kid } = decodedHeader;

      const didDoc = await this._resolver.resolve(kid);
      const jws = [_protected, payload, signature].join(".");
      await didJwt.verifyJWS(jws, didDoc.publicKey);
      return kid.match(RegExp(DID_MATCHER))[1];
    }
    return null;
  }

}
