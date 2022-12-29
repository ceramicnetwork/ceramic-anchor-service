import * as t from 'io-ts'
import * as te from '../ancillary/io-ts-extra.js'

/**
 * Metadata fields gathered from genesis commit.
 */
export const GenesisFields = t.intersection(
  [
    t.type({
      controllers: t.array(t.string),
    }),
    t.partial({
      schema: t.string.pipe(te.commitIdAsString),
      family: t.string,
      tags: t.array(t.string),
      model: t.string.pipe(te.uint8ArrayAsBase64),
    }),
  ],
  'GenesisFields'
)
export type GenesisFields = t.TypeOf<typeof GenesisFields>

/**
 * Metadata entry that we are about to store to a database.
 */
export const FreshMetadata = t.type({
  streamId: t.string.pipe(te.streamIdAsString),
  metadata: GenesisFields,
})
export type FreshMetadata = t.TypeOf<typeof FreshMetadata>

/**
 * Fields populated from a database.
 */
export const StoredMetadataFields = t.type({
  createdAt: te.date,
  updatedAt: te.date,
  usedAt: te.date,
})

/**
 * Full metadata entry if retrieved from a database.
 */
export const StoredMetadata = t.intersection([FreshMetadata, StoredMetadataFields])
export type StoredMetadata = t.TypeOf<typeof StoredMetadata>

/**
 * Metadata entry that can be stored to a database.
 */
export const MetadataInput = t.union([FreshMetadata, t.partial(StoredMetadataFields.props)])
export type MetadataInput = t.TypeOf<typeof MetadataInput>
