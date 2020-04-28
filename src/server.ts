import * as bodyParser from 'body-parser';
import { Server } from '@overnightjs/core';
import { Logger as logger } from '@overnightjs/logger';

import Context from './context';
import SchedulerService from './services/scheduler-service';
import { BlockchainService } from './services/blockchain/blockchain-service';
import { config } from "node-config-ts";

const DEFAULT_SERVER_PORT = 8081;

export default class CeramicAnchorServer extends Server {
  private readonly ctx: Context;

  constructor(ctx: Context) {
    super(true);

    this.ctx = ctx;
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));
  }

  /**
   * Start the application
   * @param port - Server listening port
   */
  public async start(port?: number): Promise<void> {
    this.addControllers(this.ctx.getControllers());

    const blockchainService: BlockchainService = this.ctx.getSelectedBlockchainService();
    await blockchainService.connect();

    if (config.mode === "bundled") {
      const schedulerSrv: SchedulerService = this.ctx.lookup('SchedulerService');
      schedulerSrv.start(); // start the scheduler
    }

    port = port || DEFAULT_SERVER_PORT;
    this.app.listen(port, () => {
      logger.Imp(`Ceramic anchor service started on port ${port}`);
    });
  }
}
