import { Config } from 'node-config-ts'
import { logger } from '../logger/index.js'
import { from, concatWith, timer, exhaustMap, catchError, repeat, retry, Subscription } from 'rxjs'
import { ServiceMetrics as Metrics } from '@ceramicnetwork/observability'
import { METRIC_NAMES } from '../settings.js'

/**
 * Repeatedly triggers a task to be run after a configured amount of ms
 */
export class SchedulerService {
  private _subscription?: Subscription

  static inject = ['config'] as const

  constructor(private readonly config: Config) {}

  /**
   * Starts the scheduler which will run the provided task
   *
   */
  start(task: () => Promise<void>): void {
    const intervalMS = this.config.schedulerIntervalMS

    const repeatingTask$ = from(task()).pipe(
      concatWith(
        timer(intervalMS).pipe(
          exhaustMap(() => task()),
          catchError((err) => {
            Metrics.count(METRIC_NAMES.SCHEDULER_TASK_UNCAUGHT_ERROR, 1)
            logger.err(`Scheduler task failed: ${err}`)
            throw err
          }),
          retry(),
          repeat()
        )
      )
    )

    this._subscription = repeatingTask$.subscribe()
  }

  stop(): void {
    this._subscription?.unsubscribe()
  }
}
