import * as cron from 'node-cron';

import { config } from 'node-config-ts';

import AnchorService from './anchor-service';
import { logger } from '../logger';
import { inject, singleton } from "tsyringe";

/**
 * Schedules anchor operations
 */
@singleton()
export default class SchedulerService {

  constructor(
    @inject("anchorService") private anchorService?: AnchorService) {
  }

  /**
   * Start the scheduler
   */
  public start(): void {
    cron.schedule(config.cronExpression, async () => {
      try {
        logger.imp('Anchor pending requests...');
        await this.anchorService.anchorRequests();
      } catch (err) {
        logger.err('Failed to anchor CIDs... ' + err);
      }
    });
  }
}
