import { jest } from '@jest/globals'

import { CID } from 'multiformats/cid'

import { create } from 'multiformats/hashes/digest'
import type { CeramicService } from '../services/ceramic-service.js'
import type { EventProducerService } from '../services/event-producer/event-producer-service.js'
import type { IIpfsService, RetrieveRecordOptions } from '../services/ipfs-service.type.js'
import { StreamID, CommitID } from '@ceramicnetwork/streamid'
import { AnchorCommit, MultiQuery, Stream } from '@ceramicnetwork/common'
import { randomBytes, randomString } from '@stablelib/random'
import { Request, RequestStatus } from '../models/request.js'
import type { AbortOptions } from '../services/abort-options.type.js'
import { Utils } from '../utils.js'

const MS_IN_MINUTE = 1000 * 60
const MS_IN_HOUR = MS_IN_MINUTE * 60

/**
 * Create random DAG-CBOR CID.
 */
export function randomCID(): CID {
  // 113 is DAG-CBOR codec identifier
  return CID.create(1, 113, create(0x12, randomBytes(32)))
}

/**
 * Create random StreamID.
 *
 * @param type - type of StreamID, "tile" by default.
 */
export function randomStreamID(type: string | number = 'tile'): StreamID {
  return new StreamID(type, randomCID())
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
      put: jest.fn((record: Record<string, unknown>, abortOptions: AbortOptions = {}) => {
        return new Promise<CID>((resolve, reject) => {
          if (abortOptions.signal) {
            const done = () => reject(new Error(`MockIpfsClient: Thrown on abort signal`))
            if (abortOptions.signal?.aborted) return done()
            abortOptions.signal?.addEventListener('abort', done)
          }
          const cid = randomCID()
          this._streams[cid.toString()] = record
          resolve(cid)
        })
      }),
    }

    this._streams = {}
  }
}

export class MockIpfsService implements IIpfsService {
  private _streams: Record<string, any> = {}

  constructor() {}

  async init(): Promise<void> {
    // Do Nothing
  }

  async retrieveRecord<T = any>(
    cid: CID | string,
    options: RetrieveRecordOptions = {}
  ): Promise<T> {
    const found = this._streams[cid.toString()]
    if (found) return found
    // Wait for 30s to imitate IPFS timeout that happens when IPFS can not retrieve a record
    await Utils.delay(30000, options.signal)
    throw new Error(`MockIpfsService:retrieveRecord:timeout`)
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
  static inject = ['ipfsService'] as const

  constructor(
    private _ipfsService: IIpfsService,
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

  // Mock-only method to control what gets returned by loadStream()
  putStream(id: StreamID | CommitID, stream: any) {
    this._streams[id.toString()] = stream
  }

  async unpinStream(streamId: StreamID) {}

  reset() {
    this._cidIndex = 0
    this._streams = {}
  }
}

export class MockEventProducerService implements EventProducerService {
  emitAnchorEvent

  constructor() {
    this.reset()
  }

  reset() {
    this.emitAnchorEvent = jest.fn(() => Promise.resolve())
  }

  destroy(): void {}
}

/**
 * Generates a single request
 * @param override request data to use. If some values are not provided, they will be generated.
 * @returns a promise for a request
 */
export function generateRequest(override: Partial<Request>): Request {
  const request = new Request()
  const streamID = randomStreamID()
  request.cid = streamID.cid.toString()
  request.streamId = streamID.toString()
  request.status = RequestStatus.PENDING
  request.createdAt = new Date(Date.now() - Math.random() * MS_IN_HOUR)
  request.updatedAt = new Date(request.createdAt.getTime())
  request.timestamp = new Date(request.createdAt.getTime())
  request.origin = `origin:random:${randomString(8)}`

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
export function generateRequests(
  override: Partial<Request>,
  count = 1,
  varianceMS = 1000
): Array<Request> {
  return times(count).map((i) => {
    if (varianceMS > 0) {
      const createdAt = override.createdAt || new Date(Date.now())
      const updatedAt = override.updatedAt || new Date(createdAt.getTime())
      return generateRequest(
        Object.assign({}, override, {
          createdAt: new Date(createdAt.getTime() + i * varianceMS),
          updatedAt: new Date(updatedAt.getTime() + i * varianceMS),
        })
      )
    }

    return generateRequest(override)
  })
}

export function times(n: number): Array<number> {
  return Array.from({ length: n }).map((_, i) => i)
}

/**
 * Create an array of length `n` filled with values `value`.
 */
export function repeat<T>(n: number, value: T): Array<T> {
  return Array.from<T>({ length: n }).fill(value)
}

/**
 * Return true if `a` and `b` are close within `delta` %.
 * Absolute difference between `a` and `b` should be less or equal to `delta * a` and `delta * b`.
 *
 * @param a - first number to compare
 * @param b - second number to compare
 * @param delta - allowed delta, default 0.01 means 1%
 */
export function isClose(a: number, b: number, delta = 0.01): boolean {
  const difference = Math.abs(a - b)
  return difference <= a * delta && difference <= b * delta
}

/**
 * Unix timestamp (in seconds) from a Date.
 * @param date
 */
export function seconds(date: Date): number {
  return Math.floor(date.valueOf() / 1000)
}
