import { Knex } from 'knex'
import { Request } from '../models/request'
import { CID } from 'multiformats/cid'
import { Config } from 'node-config-ts'

export class ReplicationRequestRepository {
  static make = make
  private readonly connection: Knex

  constructor(connection: Knex) {
    this.connection = connection
  }

  /**
   * Finds a request with the given CID if exists using the replica database.
   * @param cid CID the request is for
   * @returns Promise for the associated request
   */
  async findByCid(cid: CID | string): Promise<Request | undefined> {
    const found = await this.connection
      .table('requests')
      .where({ cid: String(cid) })
      .first()
    if (found) {
      return new Request(found)
    }
    return undefined
  }

  // Add more methods that utilize the replica connection here
}

/**
 * Injection factory.
 */
function make(config: Config, replicaConnection: Knex) {
  return new ReplicationRequestRepository(replicaConnection)
}

make.inject = ['config', 'replicaDbConnection'] as const
