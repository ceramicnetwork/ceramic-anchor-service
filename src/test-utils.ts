import { CID } from 'multiformats/cid'
import { create } from 'multiformats/hashes/digest'
import { sha256 } from 'multiformats/hashes/sha2'

import { CeramicService } from './services/ceramic-service.js'
import { IpfsService } from './services/ipfs-service.js'
import { StreamID, CommitID } from '@ceramicnetwork/streamid'
import { AnchorCommit, MultiQuery, Stream } from '@ceramicnetwork/common'
import * as dagCBOR from '@ipld/dag-cbor'
import { randomBytes } from '@stablelib/random'
import { jest } from '@jest/globals'

export async function randomCID(): Promise<CID> {
  return CID.create(1, dagCBOR.code, create(0x12, randomBytes(32)))
}

export class MockIpfsClient {
  constructor() {
    this.reset()
  }

  private _streams: Record<string, any> = {}
  pubsub
  dag

  reset() {
    this.pubsub = {
      subscribe: jest.fn(() => Promise.resolve()),
    }
    this.dag = {
      get: jest.fn((cid: CID) => {
        return Promise.resolve({ value: this._streams[cid.toString()] })
      }),
      put: jest.fn(async (record: Record<string, unknown>) => {
        const cid = await randomCID()
        this._streams[cid.toString()] = record
        return Promise.resolve(cid)
      }),
    }

    this._streams = {}
  }
}

export class MockIpfsService implements IpfsService {
  private _streams: Record<string, any> = {}

  constructor() {}

  async init(): Promise<void> {
    return null
  }

  async retrieveRecord(cid: CID | string): Promise<any> {
    return this._streams[cid.toString()]
  }

  async storeRecord(record: Record<string, unknown>): Promise<CID> {
    const cid = await randomCID()
    this._streams[cid.toString()] = record
    return cid
  }

  reset() {
    this._streams = {}
  }
}

export class MockCeramicService implements CeramicService {
  constructor(
    private _ipfsService: IpfsService,
    private _streams: Record<string, any> = {},
    private _cidIndex = 0
  ) {}

  async loadStream(streamId: StreamID): Promise<any> {
    const stream = this._streams[streamId.toString()]
    if (!stream) {
      throw new Error(`No stream found with streamid ${streamId.toString()}`)
    }
    return stream
  }

  async pinStream(streamId: StreamID): Promise<any> {}

  async multiQuery(queries: MultiQuery[]): Promise<Record<string, Stream>> {
    const result = {}
    for (const query of queries) {
      const id = query.streamId.toString()
      const stream = this._streams[id]
      if (stream) {
        result[id] = stream
      }
    }

    return result
  }

  async publishAnchorCommit(streamId: StreamID, anchorCommit: AnchorCommit): Promise<CID> {
    return this._ipfsService.storeRecord(anchorCommit)
  }

  // Mock-only method to control what gets returned by loadStream()
  putStream(id: StreamID | CommitID, stream: any) {
    this._streams[id.toString()] = stream
  }

  // Mock-only method to generate a random base StreamID
  async generateBaseStreamID(): Promise<StreamID> {
    const cid = await randomCID()
    return new StreamID('tile', cid)
  }

  async unpinStream(streamId: StreamID) {}

  reset() {
    this._cidIndex = 0
    this._streams = {}
  }
}
