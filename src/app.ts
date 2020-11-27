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
import IpfsService from "./services/ipfs-service";
import AnchorService from "./services/anchor-service";
import SchedulerService from "./services/scheduler-service";
import BlockchainService from "./services/blockchain/blockchain-service";

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
    await this.buildCtx();

    const blockchainService: BlockchainService = this.ctx.getSelectedBlockchainService();
    await blockchainService.connect();

    const mode = config.mode.trim().toLowerCase();
    switch (mode) {
      case 'server': {
        await this._startServer();
        break;
      }
      case 'anchor': {
        await this._startAnchor();
        break;
      }
      case 'bundled': {
        await this._startBundled();
        break;
      }
      default: {
        logger.Err(`Unknown application mode ${mode}`, true);
        process.exit(1);
      }
    }
    logger.Imp(`Ceramic Anchor Service started in ${mode} mode`);
  }

  /**
   * Starts bundled application (API + Anchor)
   * @private
   */
  private async _startBundled(): Promise<void> {
    const ipfsService: IpfsService = this.ctx.lookup('IpfsService');
    await ipfsService.init();

    const schedulerService: SchedulerService = this.ctx.lookup('SchedulerService');
    schedulerService.start();
    await this._startServer();
  }

  /**
   * Start application in Server mode
   * @private
   */
  private async _startServer(): Promise<void> {
    this.startWithConnectionHandling(async () => {
      const server = new CeramicAnchorServer(this.ctx);
      await server.start(config.port);
    });
  }

  /**
   * Starts application in anchoring mode (Anchor without the Server)
   * @private
   */
  private async _startAnchor(): Promise<void> {
    const ipfsService: IpfsService = this.ctx.lookup('IpfsService');
    await ipfsService.init();

    await this._executeAnchor();
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
  private async _executeAnchor(): Promise<void> {
    this.startWithConnectionHandling(async () => {
      const anchorService: AnchorService = this.ctx.lookup('AnchorService');
      await anchorService.anchorRequests();
    });
  }
}

const app = new CeramicAnchorApp();
app.start()
  .then(() => logger.Imp("Ceramic Anchor Service started..."))
  .catch((e) => {
    logger.Err(e, true);
    process.exit(1);
  });
