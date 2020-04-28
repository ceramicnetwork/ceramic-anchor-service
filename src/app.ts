import 'reflect-metadata';
require('dotenv');

import { LoggerModes } from '@overnightjs/logger';

// Set env variables
process.env.OVERNIGHT_LOGGER_MODE = LoggerModes.Console;
process.env.OVERNIGHT_LOGGER_RM_TIMESTAMP = 'false';

import { Logger as logger } from '@overnightjs/logger';

logger.Imp(`Ceramic Anchor Service running in ${process.env.NODE_ENV} mode`);

import { config } from 'node-config-ts';

import CeramicAnchorServer from './server';
import { createConnection } from 'typeorm';
import Context from "./context";
import AnchorService from "./services/anchor-service";

const DEFAULT_MODE = 'server';

export default class CeramicAnchorApp {
  private readonly ctx: Context;

  constructor() {
    this.ctx = new Context();
  }

  /**
   * Start application
   */
  public async start(): Promise<void> {
    const mode: string = config.mode || DEFAULT_MODE;

    await this.buildCtx();

    switch (config.mode) {
      case "server": {
        return this.startServer();
      }
      case "anchor": {
        return this.executeAnchor();
      }
      default: {
        console.log(`Unknown application mode ${mode}`);
        process.exit(1);
      }
    }
  }

  /**
   * Builds application context
   */
  public async buildCtx(): Promise<void> {
    await this.ctx.build('services', 'controllers');
  }

  /**
   * Wrap execution function with TypeOrm connection handling
   * @param fn - Function to be executed
   */
  private async startWithConnectionHandling(fn: Function): Promise<void> {
    // create connection with database
    // note that it's not active database connection
    // typeorm creates connection pools and uses them for requests
    createConnection().then(async () => await fn()).catch((e) => {
      console.error(`Failed to start Ceramic Anchor Service. Error ${e.message}`)
      process.exit(1)
    });
  }

  /**
   * Execute anchor process
   */
  private async executeAnchor(): Promise<void> {
    this.startWithConnectionHandling(async () => {
      const anchorService: AnchorService = this.ctx.lookup('AnchorService');
      await anchorService.anchorRequests();
    });
  }

  /**
   * Start application server
   */
  private async startServer(): Promise<void> {
    this.startWithConnectionHandling(async () => {
      const server = new CeramicAnchorServer(this.ctx);
      await server.start(config.port);
    });
  }
}

const app = new CeramicAnchorApp();
app.start().then(() => console.log("Ceramic Anchor Service started..."));

