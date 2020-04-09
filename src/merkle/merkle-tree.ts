import Proof from './proof';
import Utils from '../utils';
import { CompareFunction, MergeFunction, Node, PathDirection } from './merkle';

/**
 * Merkle tree structure
 */
export class MerkleTree<T> {
  private leaves: Node<T>[];
  private readonly levels: Node<T>[][];
  private readonly mergeFn: MergeFunction<T>;
  private readonly compareFn: CompareFunction<T> | undefined;

  /**
   * Default constructor
   * @param mergeFn
   * @param compareFn
   */
  constructor(mergeFn: MergeFunction<T>, compareFn?: CompareFunction<T>) {
    this.levels = [];
    this.mergeFn = mergeFn;
    this.compareFn = compareFn;
  }

  /**
   * Initialize Merkle structure
   * @private
   */
  public async build(leaves: any[] | undefined): Promise<void> {
    if (leaves == null) {
      throw new Error('Cannot generate Merkle structure with no elements');
    }

    this.leaves = leaves.map((leaf) => new Node(leaf));
    if (this.compareFn) {
      this.leaves.sort(this.compareFn.compare);
    }
    await this._build(this.leaves);
  }

  /**
   * Get Merkle root node
   * @param elements - Array of elements
   * @returns {void}
   */
  private async _build(elements: any[]): Promise<void> {
    if (elements == null) {
      throw new Error('Cannot generate Merkle structure with no elements');
    }
    this.levels.push(elements);

    if (elements.length === 1) {
      return; // Merkle structure generated
    }
    const nextLevelElements = [];
    for (let i = 0; i < elements.length - 1; i += 2) {
      const merged = await this.mergeFn.merge(elements[i], elements[i + 1]);
      nextLevelElements.push(merged);
    }
    if (elements.length % 2 === 1) {
      // if it's an odd level
      nextLevelElements.push(elements[elements.length - 1]);
    }
    await this._build(nextLevelElements);
  }

  /**
   * Get root element
   * @returns {*}
   */
  public getRoot(): Node<T> {
    return this.levels[this.levels.length - 1][0];
  }

  /**
   * Get proof for particular element by index
   * @param elemIndex - Element index
   * @param levelIndex - Level index (defaults to 0)
   * @param isOdd - Skip adding last element if it's an odd tree (defaults to false)
   * @returns {*[]|*}
   */
  public getProof(elemIndex: number, levelIndex = 0, isOdd = false): Proof<T>[] {
    if (levelIndex === this.levels.length - 1) {
      return [];
    }

    let left;
    let data;
    let last = false;
    if (elemIndex % 2 === 1) {
      left = true;
      data = this.levels[levelIndex][elemIndex - 1];
    } else if (elemIndex + 1 < this.levels[levelIndex].length) {
      left = false;
      data = this.levels[levelIndex][elemIndex + 1];
    } else {
      left = false;
      data = this.levels[levelIndex][elemIndex];
      last = true;
      isOdd = true;
    }

    const nextLevelIndex = levelIndex + 1;
    const nextElemIndex = Math.trunc(elemIndex / 2);
    const sub = this.getProof(nextElemIndex, nextLevelIndex, isOdd);
    if (last && isOdd) {
      // skip adding the most right leaf
      return sub;
    }

    const result = [[new Proof(data, left)]];
    result.push(sub);
    return Utils.flattenArray(result);
  }

  /**
   * Verifies proof for an element
   * @param proof - Node path proof [{...}]
   * @param element - Node element
   * @returns {Promise<boolean>}
   */
  public async verifyProof(proof: Proof<T>[], element: any): Promise<boolean> {
    let current = new Node(element);
    for (const p of proof) {
      if (p.left) {
        current = await this.mergeFn.merge(p.node, current);
      } else {
        current = await this.mergeFn.merge(current, p.node);
      }
    }
    return this.getRoot().data === current.data;
  }

  /**
   * Get direct path for particular element by index
   * @param elemIndex - Element index
   * @param levelIndex - Level index (defaults to 0)
   * @param isOdd - Skip adding last element if it's an odd tree (defaults to false)
   * @returns {*[]|*}
   */
  public async getDirectPathFromRoot(elemIndex: number, levelIndex = 0, isOdd = false): Promise<PathDirection[]> {
    if (levelIndex === this.levels.length - 1) {
      return [];
    }

    let left;
    let last = false;
    if (elemIndex % 2 === 1) {
      left = false;
    } else if (elemIndex + 1 < this.levels[levelIndex].length) {
      left = true;
    } else {
      left = true;
      last = true;
      isOdd = true;
    }

    const nextElemIndex = Math.trunc(elemIndex / 2);
    const sub = await this.getDirectPathFromRoot(nextElemIndex, levelIndex + 1, isOdd);
    if (last && isOdd) {
      return sub;
    }

    sub.push(left ? PathDirection.L : PathDirection.R);
    return sub;
  }
}
