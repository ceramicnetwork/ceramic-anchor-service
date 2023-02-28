import { CID } from 'multiformats/cid'
import * as fs from 'fs'

import { Request } from '../models/request.js'
import { BloomFilter } from '@ceramicnetwork/wasm-bloom-filter'
import { StreamID } from '@ceramicnetwork/streamid'
import {
  Node,
  type ICandidate,
  type ICandidateMetadata,
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
 * Contains all the information about a single stream being anchored. Note that multiple Requests
 * can correspond to the same Stream (if, for example, multiple back-to-back updates are done to the
 * same Stream within an anchor period), so Candidate serves to group all related Requests and keep
 * track of which CID should actually be anchored for this stream.
 */
export class Candidate implements ICandidate {
  readonly cid: CID
  readonly model: StreamID | undefined

  private _alreadyAnchored = false

  constructor(
    readonly streamId: StreamID,
    readonly request: Request,
    readonly metadata: ICandidateMetadata
  ) {
    this.request = request
    if (!request.cid) throw new Error(`No CID present for request`)
    this.cid = CID.parse(request.cid)
    this.metadata = metadata
    this.model = this.metadata.model
  }

  /**
   * Returns true if this Stream was already anchored at the time that it was loaded during the
   * anchoring process (most likely by another anchoring service after the creation of the original
   * Request(s)).
   */
  get alreadyAnchored(): boolean {
    return this._alreadyAnchored
  }

  shouldAnchor(): boolean {
    return !this._alreadyAnchored
  }

  markAsAnchored(): void {
    this._alreadyAnchored = true
  }
}

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
