import { EntityRepository, Repository, Connection, EntityManager, InsertResult } from 'typeorm'
import { Anchor } from '../models/anchor.js'
import { Request } from '../models/request.js'
import { inject, singleton } from 'tsyringe'

@singleton()
@EntityRepository(Anchor)
export class AnchorRepository extends Repository<Anchor> {
  constructor(@inject('dbConnection') private connection?: Connection) {
    super()
  }

  /**
   * Creates anchors
   * @param anchors - Anchors
   * @param manager - An optional EntityManager which if provided *must* be used for all database
   *   access. This is needed when creating anchors as part of a larger database transaction.
   */
  public async createAnchors(
    anchors: Array<Anchor>,
    manager?: EntityManager
  ): Promise<InsertResult> {
    if (!manager) {
      manager = this.connection.manager
    }
    return manager
      .getRepository(Anchor)
      .createQueryBuilder()
      .insert()
      .into(Anchor)
      .values(anchors)
      .execute()
  }

  /**
   * Gets anchor metadata
   * @param request - Request id
   */
  public async findByRequest(request: Request): Promise<Anchor> {
    return this.connection
      .getRepository(Anchor)
      .createQueryBuilder('anchor')
      .leftJoinAndSelect('anchor.request', 'request')
      .where('request.id = :requestId', { requestId: request.id })
      .getOne()
  }
}
