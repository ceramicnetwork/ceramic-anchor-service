import CID from 'cids';
import globby from 'globby';

import { encode } from 'typestub-multihashes';

export default class Utils {
  /**
   * List directory files recursively
   * @param dir - Directory path
   * @return Promise<string[]> - file absolute paths
   */
  static async listDir(dir: string): Promise<string[]> {
    return globby(`${dir}/**/*`);
  }

  /**
   * Flatten array of arrays
   * @param arr - Array of arrays
   */
  static flattenArray(arr: any[]): any[] {
    return arr.reduce((accumulator, value) => accumulator.concat(value), []);
  }

  /**
   * "sleeps" for the given number of milliseconds
   * @param mills
   */
  static async delay(mills: number): Promise<void> {
    await new Promise<void>(resolve => setTimeout(() => resolve(), mills))
  }

  /**
   * Converts ETH address to CID
   * @param codec - ETH coded
   * @param hash - ETH hash
   */
  static convertEthHashToCid(codec: string, hash: string): CID {
    const bytes = Buffer.from(hash, 'hex');

    const multihash = encode(bytes, 'keccak-256');
    const cidVersion = 1;
    return new CID(cidVersion, codec, multihash);
  }

}
