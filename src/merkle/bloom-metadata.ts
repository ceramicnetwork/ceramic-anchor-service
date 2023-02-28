import * as fs from 'fs'
import { BloomFilter } from '@ceramicnetwork/wasm-bloom-filter'
import {
  Node,
  type ICandidate,
  type MetadataFunction,
  type TreeMetadata,
} from '@ceramicnetwork/anchor-utils'

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
export class BloomMetadata implements MetadataFunction<ICandidate, TreeMetadata> {
  generateMetadata(leaves: Array<Node<ICandidate>>): TreeMetadata {
    const bloomFilterEntries = new Set<string>()
    const streamIds = []

    for (const node of leaves) {
      const candidate = node.data
      streamIds.push(candidate.streamId.toString())
      bloomFilterEntries.add(`streamid-${candidate.streamId.toString()}`)
      if (candidate.metadata.model) {
        bloomFilterEntries.add(`model-${candidate.metadata.model.toString()}`)
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
