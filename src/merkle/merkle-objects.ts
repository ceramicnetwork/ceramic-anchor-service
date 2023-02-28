import { CID } from 'multiformats/cid'
import * as fs from 'fs'

import { Request } from '../models/request.js'

import { logger } from '../logger/index.js'

import { BloomFilter } from '@ceramicnetwork/wasm-bloom-filter'
import { StreamID } from '@ceramicnetwork/streamid'
import {
  Node,
  type CompareFunction,
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
