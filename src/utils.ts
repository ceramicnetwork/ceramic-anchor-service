import { CID } from 'multiformats/cid'
import { create as createMultihash } from 'multiformats/hashes/digest'

const KECCAK_256_CODE = 0x1b
const ETH_TX_CODE = 0x93
export class Utils {
  /**
   * Flatten array of arrays
   * @param arr - Array of arrays
   */
  static flattenArray(arr: any[]): any[] {
    return arr.reduce((accumulator, value) => accumulator.concat(value), [])
  }

  /**
   * "sleeps" for the given number of milliseconds
   * @param mills
   */
  static async delay(mills: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(() => resolve(), mills))
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
   * Average array of integers
   * @param arr - Array of number
   */
  static averageArray(arr: number[]): number {

    if (arr.length == 0) {
        return 0
    }    

    return arr.reduce((total, aNumber) => total + aNumber, 0) / arr.length
  }
}
