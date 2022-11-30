import { Anchor } from '../models/anchor.js'
import { Request } from '../models/request.js'
import { inject, singleton } from 'tsyringe'
import type { Knex } from 'knex'
import { Options } from './repository-types.js'
import { ServiceMetrics as Metrics } from '../service-metrics.js'
import { METRIC_NAMES } from '../settings.js'
import { logger } from 'ethers'

export const TABLE_NAME = 'anchor'

export class AnchorWithRequest extends Anchor {
  request: Request
}

@singleton()
export class AnchorRepository {
  constructor(@inject('dbConnection') private connection?: Knex) {}

  /**
   * Creates anchors
   * @param anchors - Anchors
   * @param options
   * @returns A promise that resolve to the number of anchors created
   */
  public async createAnchors(anchors: Array<Anchor>, options: Options = {}): Promise<number> {
    const { connection = this.connection } = options

    const result = (await connection
      .table(TABLE_NAME)
      .insert(anchors)
      .onConflict('requestId')
      .ignore()) as any

    return result.rowCount
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
