import { Knex } from 'knex'
import { Request } from '../models/request.js'
import { CID } from 'multiformats/cid'

const TABLE_NAME = 'request'

/**
 * Replication request repository.
 */
export interface IReplicationRequestRepository {
  readonly table: Knex.QueryBuilder
  /**
   * Finds a request with the given CID if exists using the replica database.
   * @param cid CID the request is for
   * @returns Promise for the associated request
   */
  findByCid(cid: CID | string): Promise<Request | undefined>
}

export class ReplicationRequestRepository implements IReplicationRequestRepository {
  static inject = ['replicaDbConnection'] as const

  constructor(private readonly connection: Knex) {}

  get table(): Knex.QueryBuilder {
    return this.connection(TABLE_NAME)
  }
  /**
   * Finds a request with the given CID if exists using the replica database.
   * @param cid CID the request is for
   * @returns Promise for the associated request
   */
  async findByCid(cid: CID | string): Promise<Request | undefined> {
    const found = await this.table.where({ cid: String(cid) }).first()
    if (found) {
      return new Request(found)
    }
    return undefined
  }
  // Add more methods that utilize the replica connection here
}
