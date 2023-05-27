import { DatabaseAnchor, FreshDatabaseAnchor } from '../models/anchor.js'
import type { Request } from '../models/request.js'
import type { Knex } from 'knex'
import type { AnchorWithRequest, IAnchorRepository } from './anchor-repository.type.js'
import { parseCountResult } from './parse-count-result.util.js'
import { decode } from 'codeco'

const TABLE_NAME = 'anchor'

export class AnchorRepository implements IAnchorRepository {
  static inject = ['dbConnection'] as const

  constructor(private connection: Knex) {}

  /**
   * New instance using different database `connection`
   */
  withConnection(connection: Knex): AnchorRepository {
    return new AnchorRepository(connection)
  }

  /**
   * `... FROM anchor` SQL clause.
   */
  get table(): Knex.QueryBuilder {
    return this.connection(TABLE_NAME)
  }

  /**
   * Creates anchors
   * @param anchors - Anchors
   * @returns A promise that resolve to the number of anchors created
   */
  async createAnchors(anchors: Array<FreshDatabaseAnchor>): Promise<number> {
    const result: any = await this.table
      .insert(anchors.map((anchor) => FreshDatabaseAnchor.encode(anchor)))
      .onConflict('requestId')
      .ignore()
    return parseCountResult(result.rowCount)
  }

  /**
   *
   * Gets anchor metadata
   * @param request - Request
   * @returns A promise that resolve to the anchor associated to the request
   */
  async findByRequest(request: Request): Promise<AnchorWithRequest | null> {
    const row = await this.table.where({ requestId: request.id }).first()

    if (!row) {
      return null
    }
    const anchor = decode(DatabaseAnchor, row)

    return { ...anchor, request }
  }
}
