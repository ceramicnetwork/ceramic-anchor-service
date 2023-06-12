import { boolean, string, type, union, type TypeOf } from 'codeco'
import { cidAsString, date, enumCodec, streamIdAsString } from '@ceramicnetwork/codecs'

export enum RequestStatus {
  PENDING = 0,
  PROCESSING = 1,
  COMPLETED = 2,
  FAILED = 3,
  READY = 4,
  REPLACED = 5, // Internal status for now, translates to PENDING externally, see RequestPresentationService
}

export const FreshRequest = type(
  {
    status: enumCodec('RequestStatus', RequestStatus),
    cid: cidAsString,
    streamId: streamIdAsString,
    timestamp: date,
    origin: string,
  },
  'FreshRequest'
)
export type FreshRequest = TypeOf<typeof FreshRequest>

export const StoredRequest = type(
  {
    ...FreshRequest.props,
    id: string,
    message: string,
    pinned: boolean,
    createdAt: date,
    updatedAt: date,
  },
  'StoredRequest'
)
export type StoredRequest = TypeOf<typeof StoredRequest>

export const FreshOrStoredRequest = union([StoredRequest, FreshRequest])
export type FreshOrStoredRequest = TypeOf<typeof FreshOrStoredRequest>

export type RequestUpdateFields = Partial<{
  message: string
  status: RequestStatus
  pinned: boolean
}>

// TODO CDB-2221 https://linear.app/3boxlabs/issue/CDB-2221/turn-cas-failure-retry-back-on
// export const REQUEST_MESSAGES = {
//   conflictResolutionRejection: 'Request has failed. Updated was rejected by conflict resolution.',
// }

export class InvalidRequestStatusError extends Error {
  constructor(status: never) {
    super(`Invalid request status: ${status}`)
  }
}
