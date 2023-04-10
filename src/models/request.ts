import * as t from 'codeco'
import * as te from '../ancillary/codecs.js'

export enum RequestStatus {
  PENDING = 0,
  PROCESSING = 1,
  COMPLETED = 2,
  FAILED = 3,
  READY = 4,
  REPLACED = 5, // Internal status for now, translates to PENDING externally, see RequestPresentationService
}

export type IDBRequest = {
  id: string
  status: RequestStatus
  cid: string
  streamId: string
  message: string
  pinned: boolean
  timestamp?: string
  createdAt?: string
  updatedAt?: string
  origin?: string
}

export const RequestCodec = t.sparse({
  id: t.number,
  status: te.enum('RequestStatus', RequestStatus),
  cid: t.string,
  streamId: t.string,
  message: t.string,
  pinned: t.boolean,
  timestamp: te.date,
  // optional
  createdAt: t.optional(te.date),
  updatedAt: t.optional(te.date),
  origin: t.optional(t.string),
})
export const DATABASE_FIELDS: Array<string> = Object.keys(RequestCodec.props)

export class Request {
  id: string
  status: RequestStatus
  cid: string
  streamId: string
  message: string
  pinned: boolean
  createdAt: Date
  updatedAt: Date
  timestamp: Date
  origin?: string

  constructor(params: Partial<Request> = {}) {
    // TODO Proper input types
    // @ts-ignore
    this.id = params.id
    // @ts-ignore
    this.status = params.status
    // @ts-ignore
    this.cid = params.cid
    // @ts-ignore
    this.streamId = params.streamId
    // @ts-ignore
    this.message = params.message
    // @ts-ignore
    this.pinned = params.pinned
    // @ts-ignore
    this.createdAt = params.createdAt
    // @ts-ignore
    this.updatedAt = params.updatedAt
    // @ts-ignore
    this.timestamp = params.timestamp
    this.origin = params.origin
  }

  toDB(): IDBRequest {
    return {
      id: this.id,
      status: this.status,
      cid: this.cid.toString(),
      streamId: this.streamId.toString(),
      message: this.message,
      pinned: this.pinned,
      createdAt: this.createdAt ? te.date.encode(this.createdAt) : undefined,
      updatedAt: this.updatedAt ? te.date.encode(this.updatedAt) : undefined,
      timestamp: this.timestamp ? te.date.encode(this.timestamp) : undefined,
      origin: this.origin,
    }
  }
}

export interface RequestUpdateFields {
  message?: string
  status?: RequestStatus
  pinned?: boolean
}

// TODO CDB-2221 https://linear.app/3boxlabs/issue/CDB-2221/turn-cas-failure-retry-back-on
// export const REQUEST_MESSAGES = {
//   conflictResolutionRejection: 'Request has failed. Updated was rejected by conflict resolution.',
// }

export class InvalidRequestStatusError extends Error {
  constructor(status: never) {
    super(`Invalid request status: ${status}`)
  }
}
