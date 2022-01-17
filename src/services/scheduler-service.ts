import awsCronParser from 'aws-cron-parser'

import { Config } from 'node-config-ts'

import { AnchorService } from './anchor-service.js'
import { logger } from '../logger/index.js'
import { inject, singleton } from 'tsyringe'

/**
 * Schedules anchor operations
 */
@singleton()
export class SchedulerService {
  private _task

  constructor(
    @inject('anchorService') private anchorService?: AnchorService,
    @inject('config') private config?: Config
  ) {}

  /**
   * Start the scheduler
   *
   * Note: setInterval() can be refactored to consecutive setTimeout(s) to avoid anchoring clashing.
   */
  public start(): void {
    const cron = awsCronParser.parse(this.config.cronExpression)
    let nextScheduleTime = awsCronParser.next(cron, new Date()).getTime()

    this._task = setInterval(async () => {
      try {
        const currentTime = new Date().getTime()
        let performedAnchor = false
        if (currentTime > nextScheduleTime) {
          // Always anchor if the scheduled time delay has passed
          await this.anchorService.anchorRequests()
          performedAnchor = true
        }

        if (performedAnchor) {
          nextScheduleTime = awsCronParser.next(cron, new Date()).getTime()
        }
      } catch (err) {
        logger.err('Failed to anchor CIDs... ')
        logger.err(err)
      }
    }, 10000)
  }

  public stop(): void {
    clearInterval(this._task)
  }
}
