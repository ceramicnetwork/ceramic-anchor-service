import 'reflect-metadata';
import { LoggerModes } from '@overnightjs/logger';

import { config } from 'node-config-ts';

import CeramicAnchorServer from './server';
import { createConnection } from 'typeorm';

// Set env variables
process.env.OVERNIGHT_LOGGER_MODE = LoggerModes.Console;
process.env.OVERNIGHT_LOGGER_RM_TIMESTAMP = 'false';

// create connection with database
// note that it's not active database connection
// typeorm creates connection pools and uses them for requests
createConnection()
  .then(async (connection) => {
    const server = new CeramicAnchorServer();

    await server.buildCtx();
    await server.start(config.port);
  })
  .catch(() => process.exit(1));
