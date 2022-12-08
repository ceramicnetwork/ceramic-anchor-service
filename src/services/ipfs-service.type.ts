import type { AnchorCommit } from '@ceramicnetwork/common'
import type { StreamID } from '@ceramicnetwork/streamid'
import type { CID } from 'multiformats/cid'

export interface IIpfsService {
  /**
   * Initialize the service
   */
  init(): Promise<void>

  /**
   * Gets the record by its CID value
   * @param cid - CID value
   */
  retrieveRecord<T = any>(cid: CID | string): Promise<T>

  /**
   * Sets the record and returns its CID
   * @param record - Record value
   */
  storeRecord(record: any): Promise<CID>

  /**
   * Stores the anchor commit to ipfs and publishes an update pubsub message to the Ceramic pubsub topic
   * @param anchorCommit - anchor commit
   * @param streamId
   */
  publishAnchorCommit(anchorCommit: AnchorCommit, streamId: StreamID): Promise<CID>
}
