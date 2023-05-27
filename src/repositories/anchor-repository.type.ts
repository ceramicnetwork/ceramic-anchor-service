import { DatabaseAnchor, type FreshDatabaseAnchor } from '../models/anchor.js'
import type { Request } from '../models/request.js'
import type { Knex } from 'knex'

export type AnchorWithRequest = DatabaseAnchor & {
  request: Request
}

export interface IAnchorRepository {
  createAnchors(anchors: Array<FreshDatabaseAnchor>): Promise<number>
  findByRequest(request: Request): Promise<AnchorWithRequest | null>
  withConnection(connection: Knex): IAnchorRepository
}
