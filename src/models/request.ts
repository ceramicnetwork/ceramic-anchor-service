export const TABLE_NAME = 'request'

// How long we should retain requests that were completed or failed
export const ANCHOR_DATA_RETENTION_WINDOW = 1000 * 60 * 60 * 24 * 30 // 30 days
// Max amount of time a request should go unprocessed
export const MAX_ANCHORING_DELAY_MS = 1000 * 60 * 60 * 12 //12H
// Amount of time a request can remain processing before being retried
export const PROCESSING_TIMEOUT = 1000 * 60 * 60 * 3 //3H
// If a request fails during this window, retry
export const FAILURE_RETRY_WINDOW = 1000 * 60 * 60 * 48 // 48H

export enum RequestStatus {
  PENDING = 0,
  PROCESSING = 1,
  COMPLETED = 2,
  FAILED = 3,
  READY = 4,
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
