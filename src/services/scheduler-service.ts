import { Config } from 'node-config-ts'
import { logger } from '../logger/index.js'
import { inject, singleton } from 'tsyringe'
import { from, concatWith, timer, exhaustMap, catchError, repeat, retry, Subscription } from 'rxjs'
import { Metrics } from '@ceramicnetwork/metrics'
import { METRIC_NAMES } from '../settings.js'

/**
 * Repeatedly triggers a task to be run after a configured amount of ms
 */
@singleton()
export class SchedulerService {
  private _subscription: Subscription

  constructor(@inject('config') private config?: Config) {}

  /**
   * Starts the scheduler which will run the provided task
   *
   */
  public start(task: () => Promise<void>): void {
    const intervalMS = this.config.schedulerIntervalMS

    const repeatingTask$ = from(task()).pipe(
      concatWith(
        timer(intervalMS).pipe(
          exhaustMap(() => task()),
          catchError((err) => {
            Metrics.count(METRIC_NAMES.SCHEDULER_TASK_UNCAUGHT_ERROR, 1)
            logger.err('Failed to anchor CIDs... ')
            logger.err(err)
            throw err
          }),
          retry(),
          repeat()
        )
      )
    )

    this._subscription = repeatingTask$.subscribe()
  }

  public stop(): void {
    this._subscription.unsubscribe()
  }
}
