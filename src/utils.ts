import { CID } from 'multiformats/cid'
import { create as createMultihash } from 'multiformats/hashes/digest'

const KECCAK_256_CODE = 0x1b
const ETH_TX_CODE = 0x93

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

  /**
   * Converts ETH address to CID
   * @param hash - ETH hash
   */
  static convertEthHashToCid(hash: string): CID {
    const bytes = Buffer.from(hash, 'hex')
    const multihash = createMultihash(KECCAK_256_CODE, bytes)
    const cidVersion = 1
    return CID.create(cidVersion, ETH_TX_CODE, multihash)
  }

  /**
   * Check if a function returns value that is not null. If not null, return the value, otherwise throw an error
   * @param func
   * @param error
   */
  static checkNotNull<T>(func: () => T | null | undefined, error: string): T {
    const value = func()
    if (!value) throw new Error(error)
    return value
  }

  /**
   * Check if a async function returns value that is not null. If not null, return the value, otherwise throw an error
   * @param func
   * @param error
   */
  static async checkNotNullAsync<T>(
    func: () => Promise<T | null | undefined>,
    error: string
  ): Promise<T> {
    const value = await func()
    if (!value) throw new Error(error)
    return value
  }
}
