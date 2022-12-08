import type { Knex } from 'knex'
import { METADATA_DATABASE_KEYS, MetadataInput, StoredMetadata } from '../models/metadata.js'
import { ThrowDecoder } from '../ancillary/throw-decoder.js'

/**
 * Public interface for MetadataRepository.
 */
export interface IMetadataRepository {
  save(entry: MetadataInput): Promise<StoredMetadata>
}

/**
 * Manage `metadata` database entries.
 */
export class MetadataRepository implements IMetadataRepository {
  static inject = ['dbConnection'] as const

  constructor(private readonly connection: Knex) {}

  /**
   * `... FROM metadata` SQL clause.
   */
  private table() {
    return this.connection('metadata')
  }

  /**
   * Store metadata entry to the database.
   */
  async save(entry: MetadataInput): Promise<StoredMetadata> {
    const rows = await this.table()
      .insert(MetadataInput.encode(entry))
      .returning(METADATA_DATABASE_KEYS)
    return ThrowDecoder.decode(StoredMetadata, rows[0])
  }

  /**
   * Count all metadata entries in the database.
   */
  async countAll(): Promise<number> {
    const result = await this.table().count('streamId')
    return parseInt(String(result[0].count), 10) // `count` could be string or number, let's be pessimistic
  }
}
