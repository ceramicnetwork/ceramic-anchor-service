import awsCronParser from "aws-cron-parser";

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
   *
   * Note: setInterval() can be refactored to consecutive setTimeout(s) to avoid anchoring clashing.
   */
  public start(): void {
    const cron = awsCronParser.parse(config.cronExpression);
    let nextScheduleTime = awsCronParser.next(cron, new Date()).getTime();

    setInterval(async () => {
      const currentTime = new Date().getTime();
      if (currentTime > nextScheduleTime) {
        nextScheduleTime = awsCronParser.next(cron, new Date());
        try {
          await this.anchorService.anchorRequests();
        } catch (err) {
          logger.Err('Failed to anchor CIDs... ' + err);
        }
      }
    }, 10000);
  }
}
