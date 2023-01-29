import { CeramicClient } from '@ceramicnetwork/http-client'
import { CeramicApi, Stream, SyncOptions } from '@ceramicnetwork/common'

import type { Config } from 'node-config-ts'
import { CommitID, StreamID } from '@ceramicnetwork/streamid'
import { ServiceMetrics as Metrics } from '@ceramicnetwork/observability'
import { METRIC_NAMES } from '../settings.js'
import { logger } from '../logger/index.js'

// Interface to allow injecting a mock in tests
export interface CeramicService {
  loadStream(
    streamId: StreamID,
    sync?: SyncOptions,
    timeoutMs?: number,
    pin?: boolean
  ): Promise<any>
  pinStream(streamId: StreamID): Promise<void>
  unpinStream(streamId: StreamID): Promise<void>
}

const DEFAULT_LOAD_STREAM_TIMEOUT = 1000 * 60 // 1 minute
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

  async loadStream<T extends Stream>(
    streamId: StreamID | CommitID,
    sync: SyncOptions = SyncOptions.PREFER_CACHE,
    timeoutMs?: number,
    pin: boolean = true
  ): Promise<T> {
    let timeoutHandle: any
    const effectiveTimeout =
      timeoutMs ?? this.config.loadStreamTimeoutMs ?? DEFAULT_LOAD_STREAM_TIMEOUT
    const streamPromise = this._client
      .loadStream(streamId, { sync: SyncOptions.PREFER_CACHE, pin })
      .finally(() => {
        clearTimeout(timeoutHandle)
      })

    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Timed out loading stream: ${streamId.toString()}`))
      }, effectiveTimeout)
    })

    return (await Promise.race([streamPromise, timeoutPromise])) as T
  }

  async pinStream(streamId: StreamID): Promise<void> {
    try {
      // this.loadStream uses the 'pin' flag to pin the stream after loading it.
      // TODO(CDB-2213): Use SyncOptions.SYNC_ON_ERROR once the CAS doesn't have such a huge backlog of streams
      // that are already broken with CACAO timeouts
      await this.loadStream(streamId, SyncOptions.PREFER_CACHE, PIN_TIMEOUT, true)

      logger.debug(`Successfully pinned stream ${streamId.toString()}`)
      Metrics.count(METRIC_NAMES.PIN_SUCCEEDED, 1)
    } catch (e) {
      // Pinning is best-effort, as we don't want to fail requests if the Ceramic node is unavailable
      logger.err(`Error pinning stream ${streamId.toString()}: ${e.toString()}`)
      Metrics.count(METRIC_NAMES.PIN_FAILED, 1)
    }
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
