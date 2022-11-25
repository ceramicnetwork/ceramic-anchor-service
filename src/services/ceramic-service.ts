import { CeramicClient } from '@ceramicnetwork/http-client'
import { CeramicApi, MultiQuery, Stream, SyncOptions } from '@ceramicnetwork/common'

import type { Config } from 'node-config-ts'
import { StreamID, CommitID } from '@ceramicnetwork/streamid'
import { ServiceMetrics as Metrics } from '../service-metrics.js'
import { METRIC_NAMES } from '../settings.js'
import { logger } from '../logger/index.js'

// Interface to allow injecting a mock in tests
export interface CeramicService {
  loadStream(streamId: StreamID): Promise<any>
  pinStream(streamId: StreamID): Promise<void>
  multiQuery(queries: MultiQuery[]): Promise<Record<string, Stream>>
  unpinStream(streamId: StreamID): Promise<void>
}

const DEFAULT_LOAD_STREAM_TIMEOUT = 1000 * 60 // 1 minute
const MULTIQUERY_SERVER_TIMEOUT = 1000 * 60 // 1 minute
// 10 seconds more than server-side timeout so server-side timeout can fire first, which gives us a
// more useful error message
const MULTIQUERY_CLIENT_TIMEOUT = 1000 * 70 // 1 minute and 10 seconds
const PIN_TIMEOUT = 1000 * 60 * 2 // 2 minutes

export class CeramicServiceImpl implements CeramicService {
  private readonly _client: CeramicApi

  static inject = ['config'] as const

  /**
   * Sets dependencies
   */
  constructor(private config: Config) {
    this._client = new CeramicClient(config.ceramic.apiUrl)
  }

  async loadStream<T extends Stream>(streamId: StreamID | CommitID): Promise<T> {
    let timeout: any

    const streamPromise = this._client
      .loadStream(streamId, { sync: SyncOptions.PREFER_CACHE, pin: true })
      .finally(() => {
        clearTimeout(timeout)
      })

    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`Timed out loading stream: ${streamId.toString()}`))
      }, this.config.loadStreamTimeoutMs || DEFAULT_LOAD_STREAM_TIMEOUT)
    })

    return (await Promise.race([streamPromise, timeoutPromise])) as T
  }

  async pinStream(streamId: StreamID): Promise<void> {
    try {
      let timeout: any

      const pinPromise = this._client.pin
        .add(streamId)
        .then(() => {
          logger.debug(`Successfully pinned stream ${streamId.toString()}`)
          Metrics.count(METRIC_NAMES.PIN_SUCCEEDED, 1)
        })
        .finally(() => {
          clearTimeout(timeout)
        })

      const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Timed out pinning stream: ${streamId.toString()}`))
        }, PIN_TIMEOUT)
      })

      await Promise.race([pinPromise, timeoutPromise])
    } catch (e) {
      // Pinning is best-effort, as we don't want to fail requests if the Ceramic node is unavailable
      logger.err(`Error pinning stream ${streamId.toString()}: ${e.toString()}`)
      Metrics.count(METRIC_NAMES.PIN_FAILED, 1)
    }
  }

  async multiQuery(queries: MultiQuery[]): Promise<Record<string, Stream>> {
    let timeout: any

    const queryPromise = this._client.multiQuery(queries, MULTIQUERY_SERVER_TIMEOUT).finally(() => {
      clearTimeout(timeout)
    })

    const timeoutPromise = new Promise<Record<string, Stream>>((_, reject) => {
      timeout = setTimeout(() => {
        logger.warn(`Timed out loading multiquery`)
        reject(new Error(`Timed out loading multiquery`))
      }, MULTIQUERY_CLIENT_TIMEOUT)
    })

    return await Promise.race([queryPromise, timeoutPromise])
  }

  /**
   * Unpins the given stream from the connected Ceramic node.  Also instructs that Ceramic node
   * to publish the stream's tip before unpinning it, giving other nodes on the network one last
   * chance to fetch the tip before it is lost from the anchor service's Ceramic node.
   * @param streamId
   */
  async unpinStream(streamId: StreamID): Promise<void> {
    await this._client.pin.rm(streamId, { publish: true })
  }
}
