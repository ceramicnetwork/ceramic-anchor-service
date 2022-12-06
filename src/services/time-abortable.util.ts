import { abortable, mergeAbortSignals, TimedAbortSignal } from '@ceramicnetwork/common'

/**
 * Abort function `fn` after `timeoutMs` milliseconds or on `signal`.
 * Return result of the function if not aborted.
 */
export function timeAbortable<T>(
  timeoutMs: number,
  signal: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const timedAbortSignal = new TimedAbortSignal(timeoutMs)
  const effectiveSignal = signal
    ? mergeAbortSignals([signal, timedAbortSignal.signal])
    : timedAbortSignal.signal
  return abortable(effectiveSignal, fn)
    .catch((e) => {
      if (timedAbortSignal.signal.aborted) {
        throw new Error('Timed out storing record in IPFS')
      } else {
        throw e
      }
    })
    .finally(() => {
      timedAbortSignal.clear()
    })
}
