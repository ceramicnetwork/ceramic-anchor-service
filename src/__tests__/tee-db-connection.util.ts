import type { Knex } from 'knex'
import cloneDeep from 'lodash.clonedeep'
import { config } from 'node-config-ts'
import { createDbConnection } from '../db-connection.js'

/**
 * Use same _DB_ connection, but create a new _Knex_ connection for a different _database_.
 */
export async function teeDbConnection(
  connection: Knex,
  databaseName = `tee${Math.floor(Math.random() * 1000)}`
): Promise<Knex> {
  await connection.raw(`CREATE DATABASE ${databaseName}`)

  const teeConfig = cloneDeep(config.db)
  teeConfig.connection.database = databaseName
  return createDbConnection(teeConfig)
}
