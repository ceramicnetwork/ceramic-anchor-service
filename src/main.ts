import 'reflect-metadata'

import { CeramicAnchorApp } from './app.js'
import { logger } from './logger/index.js'
import { config } from 'node-config-ts'
import { createDbConnection, createReplicaDbConnection } from './db-connection.js'
import { createInjector } from 'typed-inject'

async function startApp() {
  logger.imp('Connecting to database...')
  const connection = await createDbConnection()
  logger.imp(`Connected to database: ${config.db.client}`)
  const { connection: replicaConnection, type: replicaDbType } = await createReplicaDbConnection()
  logger.imp(`Connected to replica database: ${config.db.client}`)

  const container = createInjector()
    .provideValue('config', config)
    .provideValue('dbConnection', connection)
    .provideValue('replicaDbConnection', { connection: replicaConnection, type: replicaDbType })

  const app = new CeramicAnchorApp(container)
  await app.start()
}

startApp().catch((e) => {
  logger.err(e)
  process.exit(1)
})
