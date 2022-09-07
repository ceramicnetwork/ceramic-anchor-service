import 'reflect-metadata'
import { CeramicAnchorApp } from './app.js'
import { logger } from './logger/index.js'
import { config } from 'node-config-ts'
import { container } from 'tsyringe'
import TypeORM from 'typeorm'
const { createConnection } = TypeORM
import knex from 'knex'

async function startApp() {
  try {
    logger.imp('Connecting to database...')
    const connection = knex(config.db)

    const [_, pendingMigrations] = await connection.migrate.list()
    if (pendingMigrations.length > 0) {
      logger.imp(`Running ${pendingMigrations.length} migrations`)
      await connection.migrate.latest().catch((err) => {
        throw new Error(`Migrations have failed: ${err}`)
      })
    }

    logger.imp(`Connected to database: ${config.db.client}`)
  } catch (e) {
    throw new Error(`Database connection failed: ${e}`)
  }

  let connection
  try {
    logger.imp('Connecting to database...')
    connection = await createConnection()
    logger.imp(`Connected to database: ${connection.name}`)
  } catch (e) {
    throw new Error(`Database connection failed: ${e}`)
  }

  const app = new CeramicAnchorApp(container, config, connection)
  await app.start()
}

startApp().catch((e) => {
  logger.err(e)
  process.exit(1)
})
