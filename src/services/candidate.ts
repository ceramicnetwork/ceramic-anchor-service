import type { ICandidate, ICandidateMetadata } from '@ceramicnetwork/anchor-utils'
import type { StreamID } from '@ceramicnetwork/streamid'
import type { Request } from '../models/request.js'
import { CID } from 'multiformats/cid'

export enum Ordering {
  LT = -1,
  EQ = 0,
  GT = 1,
}

function sortByTimestamp(a: Candidate, b: Candidate): Ordering {
  return Math.sign(a.request.timestamp.getTime() - b.request.timestamp.getTime())
}

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

  static sortByTimestamp = sortByTimestamp

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
