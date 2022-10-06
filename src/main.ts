import 'reflect-metadata'

import { CeramicAnchorApp } from './app.js'
import { logger } from './logger/index.js'
import { config } from 'node-config-ts'
import { container } from 'tsyringe'
import { createDbConnection } from './db-connection.js'

async function startApp() {
  logger.imp('Connecting to database...')
  const connection = await createDbConnection()
  logger.imp(`Connected to database: ${config.db.client}`)

  const app = new CeramicAnchorApp(container, config, connection)
  await app.start()
}

startApp().catch((e) => {
  logger.err(e)
  process.exit(1)
})
