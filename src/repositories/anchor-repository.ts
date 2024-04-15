import { StoredAnchor, FreshAnchor } from '../models/anchor.js'
import type { Request } from '../models/request.js'
import type { Knex } from 'knex'
import type { AnchorWithRequest, IAnchorRepository } from './anchor-repository.type.js'
import { parseCountResult } from './parse-count-result.util.js'
import { decode } from 'codeco'

const TABLE_NAME = 'anchor'
const chunkSize = 10000

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
  async createAnchors(anchors: Array<FreshAnchor>): Promise<number> {
    const result = await this.connection.batchInsert(TABLE_NAME, anchors.map((anchor) => FreshAnchor.encode(anchor)), chunkSize).catch(function (error) {
      console.error(error)
    }) ?? []
    return parseCountResult(result.length)
  }

  /**
   *
   * Gets anchor metadata
   * @param request - Request
   * @returns A promise that resolve to the anchor associated to the request
   */
  async findByRequest(request: Request): Promise<AnchorWithRequest | null> {
    const row = await this.table.where({ requestId: request.id }).first()
    if (!row) return null
    const anchor = decode(StoredAnchor, row)
    return { ...anchor, request }
  }

  async findByRequestId(requestId: string): Promise<StoredAnchor | null> {
    const row = await this.table.where({ requestId: requestId }).first()
    if (!row) return null
    console.log("IM HERE with ", row, requestId)
    return decode(StoredAnchor, row)
  }
}
