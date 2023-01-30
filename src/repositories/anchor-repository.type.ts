import { Anchor } from '../models/anchor.js'
import type { Request } from '../models/request.js'
import type { Knex } from 'knex'

export interface AnchorWithRequest extends Anchor {
  request: Request
}

export interface IAnchorRepository {
  createAnchors(anchors: Array<Anchor>): Promise<number>
  findByRequest(request: Request): Promise<AnchorWithRequest>
  withConnection(connection: Knex): IAnchorRepository
}
