import { CompareFunction, MergeFunction, Node, PathDirection } from './merkle';

/**
 * Merkle tree structure
 */
export class MerkleTree<T> {
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

    const leafNodes = leaves.map((leaf) => new Node(leaf, null, null));
    if (this.compareFn) {
      leafNodes.sort(this.compareFn.compare);
    }
    await this._build(leafNodes);
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
      elements[i].parent = merged
      elements[i + 1].parent = merged
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
   * Gets leaves (sorted or not)
   */
  public getLeaves(): T[] {
    return this.levels[0].map(n => n.data);
  }

  /**
   * Get proof for particular element by index.  The proof is an array of nodes representing
   * the various subtree that do *not* contain the element at elemIndex. The idea is that
   * by repeatedly merging the element with successive nodes from the proof array, you eventually
   * should get the root node of the tree.
   * @param elemIndex - Element index
   * @returns Array of proof Nodes.
   */
  public async getProof(elemIndex: number): Promise<Node<T>[]> {
    return (await this._getProofHelper(this.levels[0][elemIndex])).reverse()
  }

  /**
   * Helper method for getProof that can be called recursively to move up the tree
   * @param elem - Element whose proof we are constructing
   */
  async _getProofHelper(elem: Node<T>): Promise<Node<T>[]> {
    const parent = elem.parent
    if (!parent) {
      // We're at the root
      return []
    }

    const result = await this._getProofHelper(parent);

    const proofNode = parent.left === elem ? parent.right : parent.left
    result.push(proofNode)

    return result
  }

  /**
   * Verifies proof for an element
   * @param proof - Node path proof [{...}]
   * @param element - Node element
   * @returns {Promise<boolean>}
   */
  public async verifyProof(proof: Node<T>[], element: any): Promise<boolean> {
    let current = new Node(element, null, null);
    for (const p of proof) {
      const left = p.parent.left == p
      if (left) {
        current = await this.mergeFn.merge(p, current);
      } else {
        current = await this.mergeFn.merge(current, p);
      }
    }
    return this.getRoot().data === current.data;
  }

  /**
   * Get direct path for particular element by index
   * @param elemIndex - Element index
   * @returns Array of PathDirection objects representing the path from the root of the tree to
   * the element requested
   */
  public async getDirectPathFromRoot(elemIndex: number): Promise<PathDirection[]> {
    return (await this._getDirectPathFromRootHelper(this.levels[0][elemIndex]))
  }

  async _getDirectPathFromRootHelper(elem: Node<T>) : Promise<PathDirection[]> {
    const parent = elem.parent
    if (!parent) {
      // We're at the root
      return []
    }

    const result = await this._getDirectPathFromRootHelper(parent)
    result.push(parent.left === elem ? PathDirection.L : PathDirection.R);
    return result
  }

  /**
   * Get direct path for particular element by index
   * @param elemIndex - Element index
   * @param levelIndex - Level index (defaults to 0)
   * @param isOdd - Skip adding last element if it's an odd tree (defaults to false)
   * @returns {*[]|*}
   */
  public async getDirectPathFromRootOld(elemIndex: number, levelIndex = 0, isOdd = false): Promise<PathDirection[]> {
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
    const sub = await this.getDirectPathFromRootOld(nextElemIndex, levelIndex + 1, isOdd);
    if (last && isOdd) {
      return sub;
    }

    sub.push(left ? PathDirection.L : PathDirection.R);
    return sub;
  }
}
