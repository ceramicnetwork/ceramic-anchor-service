import { type, string, TypeOf } from 'codeco'
import { cidAsString, date } from '../ancillary/codecs.js'

/**
* Representation of an Anchor record before it has been persisted to the database.
**/
export const FreshDatabaseAnchor = type({
  requestId: string,
  proofCid: cidAsString,
  path: string,
  cid: cidAsString,
})

export type FreshDatabaseAnchor = TypeOf<typeof FreshDatabaseAnchor>

export const DatabaseAnchor = type({
  ...FreshDatabaseAnchor.props,
  id: string,
  createdAt: date,
  updatedAt: date,
})
export type DatabaseAnchor = TypeOf<typeof DatabaseAnchor>
