import * as t from 'io-ts'
import * as te from '../ancillary/io-ts-extra.js'

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
  timestamp: string
  createdAt?: string
  updatedAt?: string
  origin?: string
}

export const RequestCodec = t.intersection([
  t.type({
    id: t.number,
    status: te.enum('RequestStatus', RequestStatus),
    cid: t.string,
    streamId: t.string,
    message: t.string,
    pinned: t.boolean,
    timestamp: te.date,
  }),
  t.partial({
    createdAt: te.date,
    updatedAt: te.date,
    origin: t.string,
  }),
])
export const DATABASE_FIELDS: Array<string> = RequestCodec.types.reduce(
  (fields, t) => fields.concat(Object.keys(t.props)),
  []
)

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
    this.id = params.id
    this.status = params.status
    this.cid = params.cid
    this.streamId = params.streamId
    this.message = params.message
    this.pinned = params.pinned
    this.createdAt = params.createdAt
    this.updatedAt = params.updatedAt
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
      createdAt: this.createdAt?.toISOString(),
      updatedAt: this.updatedAt?.toISOString(),
      timestamp: this.timestamp?.toISOString(),
      origin: this.origin,
    }
  }
}

export interface RequestUpdateFields {
  message?: string
  status?: RequestStatus
  pinned?: boolean
}

export const REQUEST_MESSAGES = {
  conflictResolutionRejection: 'Request has failed. Updated was rejected by conflict resolution.',
}

export class InvalidRequestStatusError extends Error {
  constructor(status: never) {
    super(`Invalid request status: ${status}`)
  }
}
