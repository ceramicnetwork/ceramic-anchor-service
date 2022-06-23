import { CID } from 'multiformats/cid'
import { create } from 'multiformats/hashes/digest'

import { CeramicService } from './services/ceramic-service.js'
import { EventProducerService } from './services/event-producer-service.js'
import { IpfsService } from './services/ipfs-service.js'
import { StreamID, CommitID } from '@ceramicnetwork/streamid'
import { AnchorCommit, MultiQuery, Stream } from '@ceramicnetwork/common'
import * as dagCBOR from '@ipld/dag-cbor'
import { randomBytes } from '@stablelib/random'
import { jest } from '@jest/globals'
import { Request } from './models/request.js'
import { RequestStatus } from './models/request-status.js'

const MS_IN_MINUTE = 1000 * 60
const MS_IN_HOUR = MS_IN_MINUTE * 60

export async function randomCID(): Promise<CID> {
  return CID.create(1, dagCBOR.code, create(0x12, randomBytes(32)))
}

export class MockIpfsClient {
  constructor() {
    this.reset()
  }

  private _streams: Record<string, any> = {}
  pubsub: any
  dag: any

  reset() {
    this.pubsub = {
      subscribe: jest.fn(() => Promise.resolve()),
      publish: jest.fn(() => Promise.resolve()),
    }
    this.dag = {
      get: jest.fn((cid: CID) => {
        return Promise.resolve({ value: this._streams[cid.toString()] })
      }),
      put: jest.fn(async (record: Record<string, unknown>) => {
        const cid = await randomCID()
        this._streams[cid.toString()] = record
        return cid
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

  async publishAnchorCommit(anchorCommit: AnchorCommit, streamId: StreamID): Promise<CID> {
    return this.storeRecord(anchorCommit as any)
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

export class MockEventProducerService implements EventProducerService {
  public emitAnchorEvent

  constructor() {
    this.reset()
  }

  reset() {
    this.emitAnchorEvent = jest.fn(() => Promise.resolve())
  }

  destroy(): void {}
}

export async function generateRequests(
  override: Partial<Request>,
  count = 1,
  addVariance = true
): Promise<Request[]> {
  const requests = await Promise.all(
    Array.from(Array(count)).map(async (_, i) => {
      const request = new Request()
      const cid = await randomCID()
      request.cid = cid.toString()
      request.streamId = new StreamID('tile', cid).toString()
      request.status = RequestStatus.PENDING
      request.createdAt = new Date(Date.now() - Math.random() * MS_IN_HOUR)
      request.updatedAt = new Date(request.createdAt.getTime())

      Object.assign(request, override)

      if (addVariance) {
        const variance = Math.random() * 5
        request.createdAt = new Date(request.createdAt.getTime() + MS_IN_MINUTE * (i + variance))
        request.updatedAt = new Date(request.updatedAt.getTime() + MS_IN_MINUTE * (i + variance))
      }
      return request
    })
  )

  return requests
}
