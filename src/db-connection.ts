import { config } from 'node-config-ts'
import type { Db, Replicadb } from 'node-config-ts'
import type { Knex } from 'knex'
import knex from 'knex'
import snakeCase from 'lodash.snakecase'
import camelCase from 'lodash.camelcase'
import { logger } from './logger/index.js'
import pg from 'pg'
import postgresDate from 'postgres-date'

// Parse "timestamp without timezone" like it is in UTC.
pg.types.setTypeParser(1114, (value: string) => {
  return postgresDate(`${value}Z`)
})

const KNEX_TABLES = ['knex_migrations', 'knex_migrations_lock']

function toCamelCase(value: any): any {
  if (Array.isArray(value)) {
    return value.map(toCamelCase)
  }

  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, value]) => [camelCase(key), value]))
  }

  if (typeof value === 'string') {
    return camelCase(value)
  }

  return value
}

async function runMigrations(connection: Knex) {
  const [, pendingMigrations] = await connection.migrate.list()
  if (pendingMigrations.length > 0) {
    logger.imp(`Running ${pendingMigrations.length} migrations`)
    await connection.migrate.latest({ extension: 'cjs' })
  }
}

export async function createDbConnection(dbConfig: Db = config.db): Promise<Knex> {
  const knexConfig: Knex.Config = {
    client: dbConfig.client,
    connection: dbConfig.connection.connectionString || dbConfig.connection,
    debug: dbConfig.debug,
    migrations: dbConfig.migrations,
    pool: { min: 3, max: 30 },
    // In our DB, identifiers have snake case formatting while in our code identifiers have camel case formatting.
    // We use the following transformers so we can always use camel case formatting in our code.

    // transforms identifier names in our queries from camel case to snake case. This is because the DB uses snake case identifiers.
    wrapIdentifier: (value, origWrap): string => origWrap(snakeCase(value)),
    // modifies returned rows from the DB. This transforms identifiers from snake case to camel case.
    postProcessResponse: (result) => toCamelCase(result),
  }

  let connection
  try {
    connection = knex(knexConfig)
  } catch (e) {
    throw new Error(`Database connection failed: ${e}`)
  }

  await runMigrations(connection).catch((err) => {
    throw new Error(`Migrations have failed: ${err}`)
  })

  return connection
}

export async function createReplicaDbConnection(
  replica_db_config: Replicadb = config.replica_db
): Promise<{ connection: Knex; type: string }> {
  const replicaKnexConfig: Knex.Config = {
    client: replica_db_config.client,
    connection: replica_db_config.connection.connectionString || {
      host: replica_db_config.connection.host,
      port: replica_db_config.connection.port,
      user: replica_db_config.connection.user,
      password: replica_db_config.connection.password,
      database: replica_db_config.connection.database,
    },
    debug: replica_db_config.debug,
    pool: { min: 3, max: 30 },
    // In our DB, identifiers have snake case formatting while in our code identifiers have camel case formatting.
    // We use the following transformers so we can always use camel case formatting in our code.

    // transforms identifier names in our queries from camel case to snake case. This is because the DB uses snake case identifiers.
    wrapIdentifier: (value, origWrap): string => origWrap(snakeCase(value)),
    // modifies returned rows from the DB. This transforms identifiers from snake case to camel case.
    postProcessResponse: (result) => toCamelCase(result),
  }
  let connection
  try {
    // Validation that the config has all the required replica db fields else it throws
    const { host, port, user, password, database } = replica_db_config.connection
    if (!host || !port || !user || !password || !database) {
      throw new Error(
        'Missing required database connection parameters. Parameters: host, port, user, password, database'
      )
    }
    connection = knex(replicaKnexConfig)
    return { connection, type: 'replica' }
  } catch (e) {
    logger.imp(
      `Not connecting to replica db with config ${replica_db_config}, error: ${e}. Connecting to the main db for reads`
    )
    connection = await createDbConnection()
  }
  return { connection, type: 'main' }
}

/**
 * USED FOR TESTING
 * Clears all tables
 * @param connection
 */
export async function clearTables(connection: Knex): Promise<void> {
  const { rows } = await connection.raw(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_catalog = ?',
    [connection.client.database()]
  )

  await connection.transaction(async (trx) => {
    // Disable triggers for testing
    await trx.raw('SET session_replication_role = replica')

    // Delete all entries in table
    for (const { table_name: tableName } of rows) {
      if (!KNEX_TABLES.includes(tableName)) {
        await trx(tableName).del()
      }
    }
  })
}
