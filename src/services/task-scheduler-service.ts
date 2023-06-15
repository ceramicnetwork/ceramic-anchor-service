import { logger } from '../logger/index.js'
import { catchError, Observable, defer, share, timer, expand, concatMap, EMPTY, retry } from 'rxjs'
import { ServiceMetrics as Metrics } from '@ceramicnetwork/observability'
import { METRIC_NAMES } from '../settings.js'

/**
 * Repeatedly triggers a task to be run after a configured amount of ms
 */
export class TaskSchedulerService {
  private _scheduledTask$?: Observable<void>
  private _controller: AbortController

  /**
   * Starts the scheduler which will run the provided task
   *
   */
  constructor() {
    this._controller = new AbortController()
  }

  start(task: () => Promise<void>, intervalMS = 60000): void {
    if (this._scheduledTask$) {
      return
    }

    const taskWithRetryOnError$ = defer(async () => {
      if (this._controller.signal.aborted) {
        return
      }
      await task()
    }).pipe(
      catchError((err) => {
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
      expand(() => {
        if (this._controller.signal.aborted) {
          return EMPTY
        }

        return timer(intervalMS).pipe(concatMap(() => taskWithRetryOnError$))
      }),
      share()
    )

    this._scheduledTask$.subscribe()
  }

  async stop(): Promise<void> {
    if (!this._scheduledTask$) return Promise.resolve()

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
