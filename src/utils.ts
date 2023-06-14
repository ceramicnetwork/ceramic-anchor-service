import { AbortOptions } from '@ceramicnetwork/common'
import {
  defer,
  retry,
  first,
  repeat,
  firstValueFrom,
  takeUntil,
  fromEvent,
  NEVER,
  timer,
} from 'rxjs'

/**
 * Thrown when `Utils.delay` gets aborted by AbortSignal.
 */
export class DelayAbortedError extends Error {
  constructor() {
    super(`Delay aborted`)
  }
}

export class Utils {
  /**
   * "sleeps" for the given number of milliseconds
   */
  static delay(mills: number, abortSignal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, mills)
      if (abortSignal) {
        const done = () => {
          clearTimeout(timeout)
          reject(new DelayAbortedError())
        }
        if (abortSignal.aborted) done()
        abortSignal.addEventListener('abort', done)
      }
    })
  }

  static poll<T>(request: () => Promise<T>, delay = 1000, abortOptions?: AbortOptions): Promise<T> {
    const aborted = abortOptions?.signal ? fromEvent(abortOptions.signal, 'abort') : NEVER

    return firstValueFrom(
      defer(async () => {
        return await request()
      }).pipe(
        repeat({ delay }),
        retry({ delay: () => timer(delay), count: 3, resetOnSuccess: true }),
        takeUntil(aborted),
        first((result) => Boolean(result))
      )
    ).catch((err) => {
      if (abortOptions?.signal?.aborted) {
        throw new Error('Polling cancelled because aborted')
      }

      throw new Error(`Received error while polling: ${err}`)
    })
  }
}
