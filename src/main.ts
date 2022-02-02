import { CeramicAnchorApp } from './app.js'
import { logger } from './logger/index.js'

import { config } from 'node-config-ts'
import { container } from 'tsyringe'
import { createConnection } from 'typeorm'

async function startApp() {
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
