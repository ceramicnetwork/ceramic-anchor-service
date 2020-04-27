import 'reflect-metadata';

require('dotenv').config()

import { LoggerModes } from '@overnightjs/logger';

// Set env variables
process.env.OVERNIGHT_LOGGER_MODE = LoggerModes.Console;
process.env.OVERNIGHT_LOGGER_RM_TIMESTAMP = 'false';

import { Logger as logger } from '@overnightjs/logger';

logger.Imp(`Ceramic Anchor Service running in ${process.env.NODE_ENV} mode`);

import { config } from 'node-config-ts';

import CeramicAnchorServer from './server';
import { createConnection } from 'typeorm';

// create connection with database
// note that it's not active database connection
// typeorm creates connection pools and uses them for requests
createConnection()
  .then(async () => {
    const server = new CeramicAnchorServer();

    await server.buildCtx();
    await server.start(config.port);
  })
  .catch(() => process.exit(1));
