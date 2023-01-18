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
  timestamp: Date
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
