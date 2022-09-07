import { inject, singleton } from 'tsyringe'
import type { Knex } from 'knex'
import { Request } from './new-request-repository'

const TABLE_NAME = 'anchor'

export class Anchor {
  id?: number
  request_id: number
  path: string
  cid: string
  proofCid: string
  createdAt?: Date
  updatedAt?: Date
}

/**
 *
 */
interface Options {
  connection?: Knex
  limit?: number
}

@singleton()
export class AnchorRepository {
  constructor(@inject('dbConnection') private connection?: Knex) {}

  /**
   * Creates anchors
   * @param anchors - Anchors
   * @param options
   */
  public async createAnchors(anchors: Array<Anchor>, options: Options = {}): Promise<void> {
    const { connection = this.connection } = options

    const cheese = await connection(TABLE_NAME).insert(anchors)
  }

  /**
   * Gets anchor metadata
   * @param request - Request id
   */
  public async findByRequest(request: Request, options: Options = {}): Promise<Anchor> {
    const { connection = this.connection } = options

    return connection(TABLE_NAME).leftJoin('request', 'anchor.request_id', 'request.id').first()
  }
}
