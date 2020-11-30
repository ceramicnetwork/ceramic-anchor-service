import * as cron from 'node-cron';

import { config } from 'node-config-ts';
import { Logger as logger } from '@overnightjs/logger';

import AnchorService from './anchor-service';
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
        logger.Imp('Anchor pending requests...');
        await this.anchorService.anchorRequests();
      } catch (err) {
        logger.Err('Failed to anchor CIDs... ' + err);
      }
    });
  }
}
