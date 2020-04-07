import CID from 'cids'
import { promises as fsPromises } from 'fs';

import { encode } from "typestub-multihashes";

export default class Utils {
  /**
   * List directory files
   * @param path - Directory path
   */
  static async listDir(path: string): Promise<string[]> {
    return fsPromises.readdir(path);
  }

  /**
   * Flatten array of arrays
   * @param arr - Array of arrays
   */
  static flattenArray(arr: any[]): any[] {
    return arr.reduce((accumulator, value) => accumulator.concat(value), []);
  }

  /**
   * Converts ETH address to CID
   * @param codec - ETH coded
   * @param hash - ETH hash
   */
  static convertEthHashToCid(codec:string, hash:string): CID {
    const bytes = Buffer.from(hash, 'hex');

    const multihash = encode(bytes, 'keccak-256');
    const cidVersion = 1;
    return new CID(cidVersion, codec, multihash)
  }
}
