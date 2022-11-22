import { CID } from 'multiformats/cid'
import * as fs from 'fs'

import { AnchorStatus, Stream, StreamMetadata, CommitType } from '@ceramicnetwork/common'
import { CompareFunction, MergeFunction, MetadataFunction, Node, TreeMetadata } from './merkle.js'
import { Request } from '../models/request.js'

import { logger } from '../logger/index.js'
import { IpfsService } from '../services/ipfs-service.js'

import { BloomFilter } from '@ceramicnetwork/wasm-bloom-filter'
import { StreamID } from '@ceramicnetwork/streamid'

const packageJson = JSON.parse(
  fs.readFileSync(
    new URL('../../node_modules/@ceramicnetwork/wasm-bloom-filter/package.json', import.meta.url),
    'utf8'
  )
)

const BLOOM_FILTER_TYPE = 'jsnpm_@ceramicnetwork/wasm-bloom-filter'
const BLOOM_FILTER_FALSE_POSITIVE_RATE = 0.0001
const bloomFilterVersion = packageJson['version']

export interface CIDHolder {
  cid: CID
}

/**
 * Contains all the information about a single stream being anchored. Note that multiple Requests
 * can correspond to the same Stream (if, for example, multiple back-to-back updates are done to the
 * same Stream within an anchor period), so Candidate serves to group all related Requests and keep
 * track of which CID should actually be anchored for this stream.
 */
export class Candidate implements CIDHolder {
  public readonly streamId: StreamID
  private readonly _requests: Request[] = []
  private readonly _earliestRequestDate: Date

  private _cid: CID = null
  private _metadata: StreamMetadata
  private _acceptedRequests: Request[] = []
  private _failedRequests: Request[] = []
  private _rejectedRequests: Request[] = []
  private _newestAcceptedRequest: Request
  private _alreadyAnchored = false

  constructor(streamId: StreamID, requests: Request[]) {
    this.streamId = streamId
    this._requests = requests

    let minDate = requests[0].createdAt
    for (const req of requests.slice(1)) {
      if (req.createdAt < minDate) {
        minDate = req.createdAt
      }
    }
    this._earliestRequestDate = minDate
  }

  public get cid(): CID {
    return this._cid
  }

  public get metadata(): StreamMetadata {
    return this._metadata
  }

  public get earliestRequestDate(): Date {
    return this._earliestRequestDate
  }

  /**
   * All requests being considered in this batch that are on this Stream
   */
  public get requests(): Request[] {
    return this._requests
  }

  /**
   * All requests that are included in the current version of the Stream. Only available after
   * calling 'setTipToAnchor'.
   */
  public get acceptedRequests(): Request[] {
    return this._acceptedRequests
  }

  /**
   * All requests that failed to be loaded from the Ceramic node.
   */
  public get failedRequests(): Request[] {
    return this._failedRequests
  }

  /**
   * All requests that were rejected by Ceramic's conflict resolution. Only available after
   * calling 'setTipToAnchor'.
   */
  public get rejectedRequests(): Request[] {
    return this._rejectedRequests
  }

  /**
   * The Anchor database has a 1-1 foreign key reference to a single Request. This is a remnant
   * of a time when every Anchor always directly corresponded to a single Request.  Now it's
   * possible for one Anchor to satisfy multiple Requests on the same Stream, but the database
   * still expects us to provide it a single Request to link. So we somewhat arbitrarily provide
   * it the Request whose CID is latest in the log of all the Requests that were successfully
   * anchored for this stream.
   */
  public get newestAcceptedRequest(): Request {
    return this._newestAcceptedRequest
  }

  /**
   * Returns true if this Stream was already anchored at the time that it was loaded during the
   * anchoring process (most likely by another anchoring service after the creation of the original
   * Request(s)).
   */
  public get alreadyAnchored(): boolean {
    return this._alreadyAnchored
  }

  /**
   * Marks that the CommitID corresponding to this Request could not be loaded from the Ceramic node.
   * @param request
   */
  failRequest(request: Request): void {
    this._failedRequests.push(request)
  }

  /**
   * Marks that this Stream could not be loaded from the Ceramic node and we should therefore
   * fail all pending requests on this Stream.
   */
  failAllRequests(): void {
    this._failedRequests = this._requests
    this._acceptedRequests = []
  }

  allRequestsFailed(): boolean {
    return this._failedRequests.length == this._requests.length
  }

  shouldAnchor(): boolean {
    return this.cid != null && this._acceptedRequests.length > 0 && !this._alreadyAnchored
  }

  /**
   * Given the current version of the stream, updates this.cid to include the appropriate tip to
   * anchor.  Note that the CID selected may be the cid corresponding to any of the pending anchor
   * requests, or to none of them if a newer, better CID is learned about from the Ceramic node.
   * Also updates the Candidate's internal bookkeeping to keep track of which Requests
   * were included in the tip being anchored and which were rejected by the Ceramic node's conflict
   * resolution.
   * @param stream
   */
  setTipToAnchor(stream: Stream): void {
    if (stream.state.anchorStatus == AnchorStatus.ANCHORED) {
      this._alreadyAnchored = true
    } else {
      this._cid = stream.tip
      this._metadata = stream.state.next?.metadata
        ? stream.state.next.metadata
        : stream.state.metadata
    }

    // Check the log of the Stream that was loaded from Ceramic to see which of the pending requests
    // are for CIDs that are included in the current version of the Stream's log.
    const includedRequests = this._requests.filter((req) => {
      return stream.state.log.find((logEntry) => {
        return logEntry.cid.toString() == req.cid
      })
    })
    // Any requests whose CIDs don't show up in the Stream's log must have been rejected by Ceramic's
    // conflict resolution.
    const rejectedRequests = this._requests.filter((req) => {
      return !includedRequests.includes(req)
    })

    this._acceptedRequests = includedRequests
    this._rejectedRequests = rejectedRequests

    // Pick which request to put in the anchor database entry for the anchor that will result
    // from anchoring this Candidate Stream. If there are any anchor commits that are after the
    // newest request, the candidate has already been anchored.
    for (const logEntry of stream.state.log.reverse()) {
      if (logEntry.type === CommitType.ANCHOR) {
        this._alreadyAnchored = true
        return
      }

      const newestRequest = includedRequests.find((req) => req.cid == logEntry.cid.toString())

      if (newestRequest) {
        this._newestAcceptedRequest = newestRequest
        return
      }
    }
  }

  markAsAnchored(): void {
    this._alreadyAnchored = true
  }
}

/**
 * Implements IPFS merge CIDs
 */
export class IpfsMerge implements MergeFunction<CIDHolder, TreeMetadata> {
  private ipfsService: IpfsService

  constructor(ipfsService: IpfsService) {
    this.ipfsService = ipfsService
  }

  async merge(
    left: Node<CIDHolder>,
    right: Node<CIDHolder> | null,
    metadata: TreeMetadata | null
  ): Promise<Node<CIDHolder>> {
    const merged = [left.data.cid, right?.data?.cid || null]

    if (metadata) {
      const metadataCid = await this.ipfsService.storeRecord(metadata, true)
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
    return left.data.streamId.toString().localeCompare(right.data.streamId.toString())
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
