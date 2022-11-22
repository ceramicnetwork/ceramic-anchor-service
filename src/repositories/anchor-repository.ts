import { Anchor } from '../models/anchor.js'
import { Request } from '../models/request.js'
import type { Knex } from 'knex'
import { Options } from './repository-types.js'

export const TABLE_NAME = 'anchor'

export class AnchorWithRequest extends Anchor {
  request: Request
}

export class AnchorRepository {
  static inject = ['dbConnection'] as const

  constructor(private connection?: Knex) {}

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
  public async findByRequest(request: Request, options: Options = {}): Promise<AnchorWithRequest> {
    const { connection = this.connection } = options

    const anchor = await connection(TABLE_NAME).where({ requestId: request.id }).first()

    if (!anchor) {
      return anchor
    }

    return { ...anchor, request }
  }
}
