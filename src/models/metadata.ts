import {
  array,
  intersection,
  optional,
  partial,
  sparse,
  string,
  type,
  union,
  type TypeOf,
} from 'codeco'
import { controllers } from '../ancillary/codecs.js'
import {
  commitIdAsString,
  date,
  streamIdAsBytes,
  streamIdAsString,
  uint8ArrayAsBase64,
} from '@ceramicnetwork/codecs'

/**
 * Metadata fields gathered from genesis commit.
 */
export const GenesisFields = sparse(
  {
    controllers: controllers,
    schema: optional(string.pipe(commitIdAsString)),
    family: optional(string),
    tags: optional(array(string)),
    model: optional(string.pipe(uint8ArrayAsBase64).pipe(streamIdAsBytes)),
  },
  'GenesisFields'
)
export type GenesisFields = TypeOf<typeof GenesisFields>

/**
 * Metadata entry that we are about to store to a database.
 */
export const FreshMetadata = type(
  {
    streamId: string.pipe(streamIdAsString),
    metadata: GenesisFields,
  },
  'FreshMetadata'
)
export type FreshMetadata = TypeOf<typeof FreshMetadata>

/**
 * Fields populated from a database.
 */
export const StoredMetadataFields = type(
  {
    createdAt: date,
    updatedAt: date,
    usedAt: date,
  },
  'StoredMetadataFields'
)

/**
 * Full metadata entry if retrieved from a database.
 */
export const StoredMetadata = intersection(
  [FreshMetadata, StoredMetadataFields] as const,
  'StoredMetadata'
)
export type StoredMetadata = TypeOf<typeof StoredMetadata>

/**
 * Metadata entry that can be stored to a database.
 */
export const MetadataInput = union(
  [FreshMetadata, partial(StoredMetadataFields.props)],
  'MetadataInput'
)
export type MetadataInput = TypeOf<typeof MetadataInput>
