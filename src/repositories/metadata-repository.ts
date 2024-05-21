import type { Knex } from 'knex'
import { MetadataInput, StoredMetadata } from '../models/metadata.js'
import type { StreamID } from '@ceramicnetwork/streamid'
import { parseCountResult } from './parse-count-result.util.js'
import { decode } from 'codeco'
import { date, streamIdAsString } from '@ceramicnetwork/codecs'

/**
 * Public interface for MetadataRepository.
 */
export interface IMetadataRepository {
  readonly table: Knex.QueryBuilder
  /**
   * Store metadata entry to the database.
   */
  save(entry: MetadataInput): Promise<void>
  /**
   * Try to find an entry for `streamId`. Return `undefined` if not found.
   */
  retrieve(streamId: StreamID): Promise<StoredMetadata | undefined>
  /**
   * Return true if there is a row for `streamId`.
   */
  isPresent(streamId: StreamID): Promise<boolean>
  /**
   * Mark an entry as used `now`. Return true if touched, i.e. if the entry was in the database.
   */
  touch(streamId: StreamID, now?: Date): Promise<boolean>
  /**
   * Find all entries for the given `streamIds`. Return an empty array if none found.
   */
  batchRetrieve(streamIds: StreamID[]): Promise<StoredMetadata[]>
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
  get table(): Knex.QueryBuilder {
    return this.connection('metadata')
  }

  /**
   * Store metadata entry to the database.
   */
  async save(entry: MetadataInput): Promise<void> {
    await this.table.insert(MetadataInput.encode(entry)).onConflict().ignore()
  }

  /**
   * Return true if there is a row for `streamId`.
   */
  async isPresent(streamId: StreamID): Promise<boolean> {
    const result = await this.table
      .select<{ count: number | string }>(this.connection.raw(`COUNT(*)`))
      .where({ streamId: streamIdAsString.encode(streamId) })
      .first()
    return parseCountResult(result?.count) > 0
  }

  /**
   * Try to find an entry for `streamId`. Return `undefined` if not found.
   */
  async retrieve(streamId: StreamID): Promise<StoredMetadata | undefined> {
    const rows = await this.table.where({ streamId: streamId.toString() }).limit(1)
    if (rows[0]) {
      return decode(StoredMetadata, rows[0])
    } else {
      return undefined
    }
  }

  /**
   * Count all metadata entries in the database.
   */
  async countAll(): Promise<number> {
    const result = await this.table.count('streamId').first()
    return parseCountResult(result?.count)
  }

  /**
   * Mark an entry as used `now`. Return true if touched, i.e. if the entry was in the database.
   */
  async touch(streamId: StreamID, now: Date = new Date()): Promise<boolean> {
    const rowsTouched = await this.table
      .where({ streamId: streamIdAsString.encode(streamId) })
      .update({ usedAt: date.encode(now) })
    return rowsTouched > 0
  }

  /**
   * Find all entries for the given `streamIds`. Return an empty array if none found.
   */
  async batchRetrieve(streamIds: StreamID[]): Promise<StoredMetadata[]> {
    const rows = await this.table.whereIn(
      'streamId',
      streamIds.map((s) => s.toString())
    )
    return rows.map((row: any) => decode(StoredMetadata, row))
  }
}
