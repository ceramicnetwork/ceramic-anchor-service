import * as fs from 'fs'
import { CompareFunction, MergeFunction, MetadataFunction, Node, TreeMetadata } from './merkle.js'

import { logger } from '../logger/index.js'
import type { IIpfsService } from '../services/ipfs-service.type.js'

import { BloomFilter } from '@ceramicnetwork/wasm-bloom-filter'
import { CIDHolder } from './cid-holder.type.js'
import { Candidate } from './candidate.js'

const packageJson = JSON.parse(
  fs.readFileSync(
    new URL('../../node_modules/@ceramicnetwork/wasm-bloom-filter/package.json', import.meta.url),
    'utf8'
  )
)

const BLOOM_FILTER_TYPE = 'jsnpm_@ceramicnetwork/wasm-bloom-filter'
const BLOOM_FILTER_FALSE_POSITIVE_RATE = 0.0001
const bloomFilterVersion = packageJson['version']

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

/**
 * Implements IPFS merge CIDs
 */
export class IpfsLeafCompare implements CompareFunction<Candidate> {
  compare(left: Node<Candidate>, right: Node<Candidate>): number {
    try {
      // Sort by model first
      const leftModel = left.data.model?.toString()
      const rightModel = right.data.model?.toString()
      if (leftModel !== rightModel) {
        if (leftModel != null) {
          return rightModel == null
            ? -1 // null last
            : leftModel.localeCompare(rightModel)
        }
        return 1 // null last
      }

      // Sort by controller
      // If either value is an object for whatever reason it will
      // be sorted last because "[" < "d" ("[object Object]" vs "did:...")
      const leftController = String(left.data.metadata.controllers[0])
      const rightController = String(right.data.metadata.controllers[0])
      if (leftController !== rightController) {
        return leftController.localeCompare(rightController)
      }

      // Sort by stream ID
      return left.data.streamId.toString().localeCompare(right.data.streamId.toString())
    } catch (err) {
      logger.err(
        `Error while comparing stream ${left.data.streamId.toString()} to stream ${right.data.streamId.toString()}. Error: ${err}`
      )
      throw err
    }
  }
}

/**
 * Implements IPFS merge CIDs
 */
export class BloomMetadata implements MetadataFunction<Candidate, TreeMetadata> {
  generateMetadata(leaves: Array<Node<Candidate>>): TreeMetadata {
    const bloomFilterEntries = new Set<string>()
    const streamIds = []

    for (const node of leaves) {
      const candidate = node.data
      streamIds.push(candidate.streamId.toString())
      bloomFilterEntries.add(`streamid-${candidate.streamId.toString()}`)
      if (candidate.model) {
        bloomFilterEntries.add(`model-${candidate.model.toString()}`)
      }
      for (const controller of candidate.metadata.controllers) {
        bloomFilterEntries.add(`controller-${controller}`)
      }
    }

    const bloomFilter = new BloomFilter(BLOOM_FILTER_FALSE_POSITIVE_RATE, bloomFilterEntries.size)
    for (const entry of bloomFilterEntries) {
      bloomFilter.add(entry)
    }

    const serializedBloomFilter = bloomFilter.toString()
    return {
      numEntries: leaves.length,
      bloomFilter: {
        type: `${BLOOM_FILTER_TYPE}-v${bloomFilterVersion}`,
        data: serializedBloomFilter,
      },
      streamIds,
    }
  }
}
