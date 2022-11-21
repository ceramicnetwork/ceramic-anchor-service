import { CID } from 'multiformats/cid'
import { create } from 'multiformats/hashes/digest'

import { CeramicService } from '../services/ceramic-service.js'
import { EventProducerService } from '../services/event-producer/event-producer-service.js'
import { IpfsService } from '../services/ipfs-service.js'
import { StreamID, CommitID } from '@ceramicnetwork/streamid'
import { AnchorCommit, MultiQuery, Stream } from '@ceramicnetwork/common'
import { randomBytes } from '@stablelib/random'
import { jest } from '@jest/globals'
import { Request, RequestStatus } from '../models/request.js'

const MS_IN_MINUTE = 1000 * 60
const MS_IN_HOUR = MS_IN_MINUTE * 60

/**
 * Create random DAG-CBOR CID
 */
export function randomCID(): CID {
  // 113 is DAG-CBOR codec identifier
  return CID.create(1, 113, create(0x12, randomBytes(32)))
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
        const cid = randomCID()
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
    const cid = randomCID()
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
    const cid = randomCID()
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
    this.emitAnchorEvent = jest.fn((body: string) => Promise.resolve())
  }

  destroy(): void {}
}

/**
 * Generates a single request
 * @param override request data to use. If some values are not provided, they will be generated.
 * @returns a promise for a request
 */
export async function generateRequest(override: Partial<Request>) {
  const request = new Request()
  const cid = randomCID()
  request.cid = cid.toString()
  request.streamId = new StreamID('tile', cid).toString()
  request.status = RequestStatus.PENDING
  request.createdAt = new Date(Date.now() - Math.random() * MS_IN_HOUR)
  request.updatedAt = new Date(request.createdAt.getTime())

  Object.assign(request, override)

  return request
}

/**
 * Generates an array of requests
 * @param override request data to use. If some values are not provided, they will be generated.
 * @param count number of requests to generate (defaults to 1)
 * @param varianceMS time between generated requests (defaults to 1000 ms)
 * @returns a promise for an array of count requests
 */
export async function generateRequests(
  override: Partial<Request>,
  count = 1,
  varianceMS = 1000
): Promise<Request[]> {
  const requests = await Promise.all(
    Array.from(Array(count)).map(async (_, i) => {
      if (varianceMS > 0) {
        const createdAt = override.createdAt || new Date(Date.now())
        const updatedAt = override.updatedAt || new Date(createdAt.getTime())

        return generateRequest({
          createdAt: new Date(createdAt.getTime() + i * varianceMS),
          updatedAt: new Date(updatedAt.getTime() + i * varianceMS),
          ...override,
        })
      }

      return generateRequest(override)
    })
  )

  return requests
}
