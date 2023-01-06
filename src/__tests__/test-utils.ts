import { jest } from '@jest/globals'
import { CID } from 'multiformats/cid'
import { create } from 'multiformats/hashes/digest'
import type { CeramicService } from '../services/ceramic-service.js'
import type { EventProducerService } from '../services/event-producer/event-producer-service.js'
import type { IIpfsService, RetrieveRecordOptions } from '../services/ipfs-service.type.js'
import { StreamID, CommitID } from '@ceramicnetwork/streamid'
import { AnchorCommit, AnchorStatus, MultiQuery, Stream } from '@ceramicnetwork/common'
import { randomBytes } from '@stablelib/random'
import { Request, RequestStatus } from '../models/request.js'
import type { AbortOptions } from '../services/abort-options.type.js'
import { Utils } from '../utils.js'
import type { Server } from 'http'
import express from 'express'
import { RequestRepository } from '../repositories/request-repository.js'
import { concatMap, firstValueFrom, interval, throwError, timeout } from 'rxjs'
import { filter } from 'rxjs/operators'
import { CeramicAnchorApp } from '../app'
import { AnchorService } from '../services/anchor-service'

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
    await Utils.delay(30000, options.signal) // Wait for 30s
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

      return generateRequest({
        createdAt: new Date(createdAt.getTime() + i * varianceMS),
        updatedAt: new Date(updatedAt.getTime() + i * varianceMS),
        ...override,
      })
    }

    return generateRequest(override)
  })
}

export function times(n: number): Array<number> {
  return Array.from({ length: n }).map((_, i) => i)
}

export class FauxAnchorLauncher {
  private server: Server | undefined = undefined

  static async create(port: number): Promise<FauxAnchorLauncher> {
    const launcher = new FauxAnchorLauncher(port)
    await launcher.start()
    return launcher
  }

  constructor(private readonly port: number) {}

  async start() {
    const app = express()
    app.all('/', (req, res) => {
      res.send({ status: 'success' })
    })
    this.server = await new Promise((resolve, reject) => {
      const server = app
        .listen(this.port, () => {
          console.log(`Listening on port ${this.port}`)
          resolve(server)
        })
        .on('error', (error) => {
          reject(error)
        })
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) =>
      this.server.close((error) => {
        error ? reject(error) : resolve()
      })
    )
  }
}

/**
 * Resolves when no requests are in +RequestStatus.READY+ status.
 */
export async function waitForNoReadyRequests(
  requestRepo: RequestRepository,
  timeoutMS = 30 * 1000
): Promise<void> {
  await firstValueFrom(
    interval(1000).pipe(
      concatMap(() => requestRepo.findByStatus(RequestStatus.READY)),
      filter((requests) => requests.length == 0),
      timeout({
        each: timeoutMS,
        with: () =>
          throwError(
            () => new Error(`Timeout waiting for requests to move from READY to PROCESSING`)
          ),
      })
    )
  )
}

export async function waitForAnchor(stream: Stream, timeoutMS = 30 * 1000): Promise<void> {
  await firstValueFrom(
    stream.pipe(
      filter((state) => [AnchorStatus.ANCHORED, AnchorStatus.FAILED].includes(state.anchorStatus)),
      timeout({
        each: timeoutMS,
        with: () =>
          throwError(
            () => new Error(`Timeout waiting for stream ${stream.id.toString()} to become anchored`)
          ),
      })
    )
  )
}

export async function waitForTip(stream: Stream, tip: CID, timeoutMS = 30 * 1000): Promise<void> {
  await firstValueFrom(
    stream.pipe(
      filter((state) => state.log[state.log.length - 1].cid.equals(tip)),
      timeout({
        each: timeoutMS,
        with: () =>
          throwError(
            () =>
              new Error(`Timeout waiting for ceramic to receive cid ${tip} for stream ${stream}`)
          ),
      })
    )
  )
}

export async function anchorUpdate(
  stream: Stream,
  anchorApp: CeramicAnchorApp,
  anchorService: AnchorService
): Promise<void> {
  // The anchor request is not guaranteed to already have been sent to the CAS when the create/update
  // promise resolves, so we wait a bit to give the ceramic node time to actually send the request
  // before triggering the anchor.
  // TODO(js-ceramic #1919): Remove this once Ceramic won't return from a request that makes an
  // anchor without having already made the anchor request against the CAS.
  await Utils.delay(5000)
  await anchorService.emitAnchorEventIfReady()
  await anchorApp.anchor()
  await waitForAnchor(stream)
}
