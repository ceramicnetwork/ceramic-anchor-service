import { type, string, TypeOf } from 'codeco'
import { cidAsString, date } from '../ancillary/codecs.js'

/**
 * Representation of an Anchor record before it has been persisted to the database.
 **/
export const FreshAnchor = type({
  requestId: string,
  proofCid: cidAsString,
  path: string,
  cid: cidAsString,
})

export type FreshAnchor = TypeOf<typeof FreshAnchor>

/**
* Representation of an Anchor record within the database
*/
export const StoredAnchor = type({
  ...FreshAnchor.props,
  id: string,
  createdAt: date,
  updatedAt: date,
})
export type StoredAnchor = TypeOf<typeof StoredAnchor>
