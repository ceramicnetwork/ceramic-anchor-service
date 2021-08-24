import CeramicClient from '@ceramicnetwork/http-client'
import { CeramicApi, MultiQuery, Stream, SyncOptions } from '@ceramicnetwork/common'

import { Config } from 'node-config-ts'
import { inject, singleton } from 'tsyringe'
import { IpfsService } from './ipfs-service'
import { StreamID, CommitID } from '@ceramicnetwork/streamid'

// Interface to allow injecting a mock in tests
export interface CeramicService {
  loadStream(streamId: StreamID): Promise<any>
  multiQuery(queries: MultiQuery[]): Promise<Record<string, Stream>>
}

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
      .loadStream(streamId, { sync: SyncOptions.PREFER_CACHE })
      .finally(() => {
        clearTimeout(timeout)
      })

    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`Timed out loading stream: ${streamId.toString()}`))
      }, 60 * 1000)
    })

    return (await Promise.race([streamPromise, timeoutPromise])) as T
  }

  async multiQuery(queries: MultiQuery[]): Promise<Record<string, Stream>> {
    let timeout: any

    const queryPromise = this._client.multiQuery(queries).finally(() => {
      clearTimeout(timeout)
    })

    const timeoutPromise = new Promise<Record<string, Stream>>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`Timed out loading multiquery`))
      }, 60 * 1000)
    })

    return await Promise.race([queryPromise, timeoutPromise])
  }
}
