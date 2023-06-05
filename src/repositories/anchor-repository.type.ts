import { StoredAnchor, type FreshAnchor } from '../models/anchor.js'
import type { Request } from '../models/request.js'
import type { Knex } from 'knex'

export type AnchorWithRequest = StoredAnchor & {
  request: Request
}

export interface IAnchorRepository {
  createAnchors(anchors: Array<FreshAnchor>): Promise<number>
  findByRequest(request: Request): Promise<AnchorWithRequest | null>
  withConnection(connection: Knex): IAnchorRepository
}
