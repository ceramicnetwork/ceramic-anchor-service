import { logger } from '../logger/index.js'
import { catchError, Observable, Subscription, defer, share, timer, expand, concatMap, EMPTY, retry } from 'rxjs'
import { ServiceMetrics as Metrics } from '@ceramicnetwork/observability'
import { METRIC_NAMES } from '../settings.js'

/**
 * Repeatedly triggers a task to be run after a configured amount of ms
 */
export class TaskSchedulerService {
  private _scheduledTask$?: Observable<boolean | void>
  private _controller: AbortController
  private _subscription?: Subscription


  constructor() {
    this._controller = new AbortController()
  }


  /**
   * Starts the scheduler which will run the provided task at regular intervals
   * @param task task to perform regularly with a delay of intervalMS between runs
   * @param intervalMS default: 60000, delay between task runs
   * @param cbAfterFailure default undefined. cbAfterFailure is the callback to run if the task returns false. A task returning false indicates that it did not run or finish. 
   * cbAfterFailure will not be called if the task errors. If cbAfterFailure is not set then the scheduler will continue to run the task regardless if the task was successful or not.
   */
  start(task: () => Promise<boolean | void>, intervalMS = 60000, cbAfterFailure?: () => Promise<void>): void {
    if (this._scheduledTask$) {
      throw new Error('Task already scheduled')
    }

    const taskWithRetryOnError$ = defer(async (): Promise<boolean> => {
      if (this._controller.signal.aborted) {
        return false
      }

      return await task().then(result => result === undefined || result)
    }).pipe(
      catchError((err: Error) => {
        Metrics.count(METRIC_NAMES.SCHEDULER_TASK_UNCAUGHT_ERROR, 1)
        logger.err(`Scheduler task failed: ${err}`)

        if (this._controller.signal.aborted) {
          return EMPTY
        }

        throw err
      }),
      retry({
        delay: intervalMS,
        count: 3,
        resetOnSuccess: true,
      })
    )

    this._scheduledTask$ = taskWithRetryOnError$.pipe(
      expand((success: boolean) => {
        if (this._controller.signal.aborted) {
          return EMPTY
        }

        if (cbAfterFailure && !success) {
          logger.imp(`Last run of the task was not successful. Stopping the task scheduler`)
          return EMPTY
        }

        return timer(intervalMS).pipe(concatMap(() => taskWithRetryOnError$))
      }),
      share()
    )


    this._subscription = this._scheduledTask$.subscribe({
      complete: async () => {
        if (cbAfterFailure) await cbAfterFailure()
      }
    })
  }

  async stop(): Promise<void> {
    if (!this._scheduledTask$) return Promise.resolve()

    if (!this._subscription || this._subscription.closed) return Promise.resolve()

    return new Promise((resolve) => {
      this._scheduledTask$?.subscribe({
        complete: () => {
          this._scheduledTask$ = undefined
          resolve()
        },
      })

      this._controller.abort()
    })
  }
}
