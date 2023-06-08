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
}
