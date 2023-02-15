import type { MergeFunction, TreeMetadata } from './merkle.js'
import { Node } from './merkle.js'
import type { CIDHolder } from './cid-holder.type.js'
import type { IIpfsService } from '../services/ipfs-service.type.js'
import { logger } from '../logger/index.js'

/**
 * Implements IPFS merge CIDs
 */
export class IpfsMerge implements MergeFunction<CIDHolder, TreeMetadata> {
  constructor(private readonly ipfsService: IIpfsService) {}

  async merge(
    left: Node<CIDHolder>,
    right: Node<CIDHolder> | null = null,
    metadata: TreeMetadata | null = null
  ): Promise<Node<CIDHolder>> {
    const merged = [left.data.cid, right?.data?.cid || null]

    if (metadata) {
      const metadataCid = await this.ipfsService.storeRecord(metadata)
      merged.push(metadataCid)
    }

    const mergedCid = await this.ipfsService.storeRecord(merged)
    logger.debug('Merkle node ' + mergedCid + ' created.')
    return new Node<CIDHolder>({ cid: mergedCid }, left, right)
  }
}
