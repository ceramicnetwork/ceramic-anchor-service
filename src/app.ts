import 'reflect-metadata';
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

import { LoggerModes } from '@overnightjs/logger';

// Set env variables
process.env.OVERNIGHT_LOGGER_MODE = LoggerModes.Console;
process.env.OVERNIGHT_LOGGER_RM_TIMESTAMP = 'false';

import { config } from 'node-config-ts';
import { Logger as logger } from '@overnightjs/logger';

import CeramicAnchorServer from './server';
import { createConnection } from 'typeorm';
import Context from "./context";
import AnchorService from "./services/anchor-service";
import { BlockchainService } from "./services/blockchain/blockchain-service";
import SchedulerService from "./services/scheduler-service";
import CeramicService from "./services/ceramic-service";

import { initializeTransactionalContext } from 'typeorm-transactional-cls-hooked';

initializeTransactionalContext();

/**
 * Ceramic Anchor Service application
 */
export default class CeramicAnchorApp {
  private readonly ctx: Context;

  constructor() {
    this.ctx = new Context();
  }

  /**
   * Start application
   */
  public async start(): Promise<void> {
    const mode: string = config.mode.trim().toLowerCase();

    await this.buildCtx();

    if (config.mode === 'server') {
      // start in server mode

      await this.startServer();
      logger.Imp(`Ceramic Anchor Service started in server mode`);
      return;
    }

    // connect to blockchain
    const blockchainService: BlockchainService = this.ctx.getSelectedBlockchainService();
    await blockchainService.connect();

    if (config.mode === 'anchor') {
      // start in anchor mode (batch anchor processing)
      const ceramicService: CeramicService = this.ctx.lookup('CeramicService');
      await ceramicService.init();

      const anchorService: AnchorService = this.ctx.lookup('AnchorService');
      await anchorService.init();

      await this.executeAnchor();
      logger.Imp(`Ceramic Anchor Service started in anchor mode`);
      return;
    }

    if (config.mode === "bundled") {
      // start in bundled mode (server + anchor)
      const ceramicService: CeramicService = this.ctx.lookup('CeramicService');
      await ceramicService.init();

      const anchorService: AnchorService = this.ctx.lookup('AnchorService');
      await anchorService.init();

      const schedulerService: SchedulerService = this.ctx.lookup('SchedulerService');
      schedulerService.start(); // start the scheduler
      await this.startServer();
      logger.Imp(`Ceramic Anchor Service started in bundled mode`);
      return;
    }

    logger.Imp(`Unknown application mode ${mode}`);
    process.exit(1);
  }

  /**
   * Builds application context
   */
  public async buildCtx(): Promise<void> {
    await this.ctx.build('services', 'controllers', 'repositories');
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
      logger.Err(`Failed to start Ceramic Anchor Service. Error ${e.message}`);
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
app.start().then(() => logger.Imp("Ceramic Anchor Service started..."));

