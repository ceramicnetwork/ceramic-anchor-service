export enum RequestStatus {
  PENDING = 0,
  DEPRECATED_PROCESSING = 1,
  COMPLETED = 2,
  FAILED = 3,
}

export class InvalidRequestStatusError extends Error {
  constructor(status: never) {
    super(`Invalid request status: ${status}`)
  }
}
