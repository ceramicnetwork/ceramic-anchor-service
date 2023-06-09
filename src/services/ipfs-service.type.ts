import type { AnchorCommit } from '@ceramicnetwork/common'
import type { StreamID } from '@ceramicnetwork/streamid'
import type { CAR } from 'cartonne'
import type { CID } from 'multiformats/cid'
import type { AbortOptions } from './abort-options.type.js'

export type RetrieveRecordOptions = {
  path?: string
} & AbortOptions

export interface IIpfsService {
  /**
   * Initialize the service
   */
  init(): Promise<void>

  /**
   * Gets the record by its CID value
   * @param cid - CID value
   * @param options - Can pass AbortSignal or IPLD `path`.
   */
  retrieveRecord<T = unknown>(cid: CID | string, options?: RetrieveRecordOptions): Promise<T>

  /**
   * Sets the record and returns its CID
   * @param record - Record value
   * @param options - Can pass AbortSignal
   */
  storeRecord(record: any, options?: AbortOptions): Promise<CID>

  /**
   * Import CAR file. Pin all the entries.
   */
  importCAR(car: CAR, options?: AbortOptions): Promise<void>

  /**
   * Stores the anchor commit to ipfs and publishes an update pubsub message to the Ceramic pubsub topic
   * @param anchorCommit - anchor commit
   * @param streamId
   * @param options - Can pass AbortSignal
   */
  publishAnchorCommit(
    anchorCommit: AnchorCommit,
    streamId: StreamID,
    options?: AbortOptions
  ): Promise<CID>
}
