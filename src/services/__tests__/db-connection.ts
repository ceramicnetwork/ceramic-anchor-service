import type { Connection, ConnectionOptions } from 'typeorm'
import TypeORM from 'typeorm'
const { createConnection } = TypeORM
import { Anchor } from '../../models/anchor.js'
import { Request } from '../../models/request.js'

const DB_NAME = 'test_anchor_db'

const basePgConfig: ConnectionOptions = {
  name: 'base',
  type: 'postgres',
  url: process.env.DATABASE_URL,
  username: 'test-user',
  logging: false,
}

function getPgConfig(name: string): ConnectionOptions {
  return Object.assign({}, basePgConfig, {
    name: name,
    database: DB_NAME,
    entities: [Request, Anchor],
    synchronize: true,
    logging: false,
    dropSchema: true,
  })
}

const createDb = async () => {
  const rootConnection = await createConnection(basePgConfig)

  const dbName = 'test_anchor_db'
  const dbsFound = await rootConnection.query(
    `SELECT datname FROM pg_catalog.pg_database WHERE lower(datname) = lower('${dbName}');`
  )

  if (dbsFound.length === 0) {
    await rootConnection.query('CREATE DATABASE ' + dbName)
  }
}

export const DBConnection = {
  numConnections: 0,
  rootConnection: null,
  dbCreated: false,

  async create(): Promise<Connection> {
    if (!this.dbCreated) {
      await createDb()
      this.dbCreated = true
    }

    const pgConf = getPgConfig('testConnection' + this.numConnections++)
    return await createConnection(pgConf)
  },

  async close(connection: Connection): Promise<void> {
    await connection.close()
  },

  async clear(connection: Connection): Promise<void> {
    const entities = connection.entityMetadatas

    await connection.transaction(async (transactionEntityManager) => {
      for (const entity of entities) {
        const repository = transactionEntityManager.connection.getRepository(entity.name)

        // Defer foreign key enforcement until transaction commits
        await repository.query('SET session_replication_role = replica')

        // Delete all entries in table
        await repository.query(`DELETE FROM ${entity.tableName}`)
      }
    })
  },
}
