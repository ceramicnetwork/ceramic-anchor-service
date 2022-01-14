import CeramicClient from '@ceramicnetwork/http-client'
import { AnchorCommit, CeramicApi, MultiQuery, Stream, SyncOptions } from '@ceramicnetwork/common'

import { Config } from 'node-config-ts'
import { inject, singleton } from 'tsyringe'
import { IpfsService } from './ipfs-service'
import { StreamID, CommitID } from '@ceramicnetwork/streamid'
import type { CID } from 'multiformats/cid'
import * as Block from 'multiformats/block'
import * as codec from '@ipld/dag-cbor'
import { sha256 as hasher } from 'multiformats/hashes/sha2'
import { logger } from '../logger'

// Interface to allow injecting a mock in tests
export interface CeramicService {
  loadStream(streamId: StreamID): Promise<any>
  pinStream(streamId: StreamID): Promise<void>
  multiQuery(queries: MultiQuery[]): Promise<Record<string, Stream>>
  publishAnchorCommit(streamId: StreamID, anchorCommit: AnchorCommit): Promise<CID>
}

const LOAD_STREAM_TIMEOUT = 1000 * 60 // 1 minute
const MULTIQUERY_SERVER_TIMEOUT = 1000 * 60 // 1 minute
// 10 seconds more than server-side timeout so server-side timeout can fire first, which gives us a
// more useful error message
const MULTIQUERY_CLIENT_TIMEOUT = 1000 * 70 // 1 minute and 10 seconds
const PIN_TIMEOUT = 1000 * 60 * 2 // 2 minutes

@singleton()
export default class CeramicServiceImpl implements CeramicService {
  private readonly _client: CeramicApi

  /**
   * Sets dependencies
   */
  constructor(
    @inject('config') private config?: Config,
    @inject('ipfsService') private ipfsService?: IpfsService
  ) {
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
      }, LOAD_STREAM_TIMEOUT)
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

  async publishAnchorCommit(streamId: StreamID, anchorCommit: AnchorCommit): Promise<CID> {
    const block = await Block.encode({ value: anchorCommit, codec, hasher })
    const expectedCID = block.cid
    const stream = await this._client.applyCommit(streamId, anchorCommit, {
      publish: true,
      anchor: false,
      pin: true, // Important in case the stream wasn't pinned on the original request
    })

    const commitFound: boolean =
      null != stream.state.log.find((logEntry) => logEntry.cid.equals(expectedCID))
    if (!commitFound) {
      throw new Error(
        `Anchor commit not found in stream log after being applied to Ceramic node. This most likely means the commit was rejected by Ceramic's conflict resolution. StreamID: ${streamId.toString()}, found tip: ${stream.tip.toString()}`
      )
    }
    return expectedCID
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
