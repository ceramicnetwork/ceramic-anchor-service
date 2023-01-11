export enum RequestStatus {
  PENDING = 0,
  PROCESSING = 1,
  COMPLETED = 2,
  FAILED = 3,
  READY = 4,
  REPLACED = 5, // Internal status for now, translates to PENDING externally, see RequestPresentationService
}

export type IDBRequest = {
  id: number
  status: RequestStatus
  cid: string
  streamId: string
  message: string
  pinned: boolean
  createdAt?: string
  updatedAt?: string
  timestamp: string
  origin?: string
}

export class Request {
  id: number
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
