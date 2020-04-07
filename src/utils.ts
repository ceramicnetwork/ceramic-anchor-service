import { promises as fsPromises } from 'fs';

export default class Utils {
  static async listDir(path: string): Promise<string[]> {
    return fsPromises.readdir(path);
  }

  static flattenArray(arr: any[]): any[] {
    return arr.reduce((accumulator, value) => accumulator.concat(value), []);
  }
}
