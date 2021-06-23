import awsCronParser from "aws-cron-parser";

import { Config } from 'node-config-ts';

import AnchorService from './anchor-service';
import { logger } from '../logger';
import { inject, singleton } from "tsyringe";

/**
 * Schedules anchor operations
 */
@singleton()
export default class SchedulerService {

  constructor(
    @inject("anchorService") private anchorService?: AnchorService,
    @inject('config') private config?: Config) {
  }

  /**
   * Start the scheduler
   *
   * Note: setInterval() can be refactored to consecutive setTimeout(s) to avoid anchoring clashing.
   */
  public start(): void {
    const cron = awsCronParser.parse(this.config.cronExpression);
    let nextScheduleTime = awsCronParser.next(cron, new Date()).getTime();

    setInterval(async () => {
      try {
        const currentTime = new Date().getTime();
        let performedAnchor = false
        if (currentTime > nextScheduleTime) {
          // Always anchor if the scheduled time delay has passed
          await this.anchorService.anchorRequests();
          performedAnchor = true
        } else {
          // Even if we're not up to the scheduled anchor time, we may want to anchor early if
          // we have too many pending requests built up.
          performedAnchor = await this.anchorService.anchorIfTooManyPendingRequests();
        }

        if (performedAnchor) {
          nextScheduleTime = awsCronParser.next(cron, new Date()).getTime();
        }
      } catch (err) {
      logger.err('Failed to anchor CIDs... ');
      logger.err(err);
    }
    }, 10000);
  }
}
