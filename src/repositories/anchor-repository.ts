import { inject, singleton } from 'tsyringe'
import type { Knex } from 'knex'
import { Request } from '../models/request.js'
import { Anchor, TABLE_NAME } from '../models/anchor.js'
import { Options } from './repository-types.js'

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
    await connection(TABLE_NAME).insert(anchors)
  }

  /**
   *
   * Gets anchor metadata
   * @param request - Request
   * @param options
   * @returns A promise that resolve to the anchor associated to the request
   */
  public async findByRequest(request: Request, options: Options = {}): Promise<Anchor> {
    const { connection = this.connection } = options

    const { requestId, ...anchorWithoutRequestId } = await connection(TABLE_NAME)
      .where({ requestId: request.id })
      .first()

    return { ...anchorWithoutRequestId, request }
  }
}
