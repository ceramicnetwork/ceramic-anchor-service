import * as bodyParser from 'body-parser';
import { Server } from '@overnightjs/core';
import { Logger as logger } from '@overnightjs/logger';

import Context from './context';
import SchedulerService from './services/scheduler-service';
import BlockchainService from './services/blockchain-service';

export default class CeramicAnchorServer extends Server {
  private readonly ctx: Context;

  constructor() {
    super(true);

    this.ctx = new Context();
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));
  }

  /**
   * Builds application context
   */
  public async buildCtx(): Promise<void> {
    await this.ctx.build('services', 'controllers');

    // registers controllers
    this.addControllers(this.ctx.getControllers());
  }

  /**
   * Start the application
   * @param port - Server listening port
   */
  public async start(port?: number): Promise<void> {
    const blockchainSrv: BlockchainService = this.ctx.lookup('BlockchainService');
    await blockchainSrv.connect();

    const schedulerSrv: SchedulerService = this.ctx.lookup('SchedulerService');
    schedulerSrv.start(); // start the scheduler

    port = port || 3000;
    this.app.listen(port, () => {
      logger.Imp('Ceramic anchor service started on port ' + port);
    });
  }
}
