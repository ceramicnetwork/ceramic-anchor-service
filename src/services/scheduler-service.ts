import * as cron from 'node-cron';

import { config } from 'node-config-ts';
import { Logger as logger } from '@overnightjs/logger';

import Context from '../context';
import AnchorService from './anchor-service';
import Contextual from '../contextual';

/**
 * Schedules anchor operations
 */
export default class SchedulerService implements Contextual {
  private anchorService: AnchorService;

  setContext(context: Context): void {
    this.anchorService = context.lookup('AnchorService');
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
