import { CompareFunction, MergeFunction, Node, PathDirection } from './merkle';
import { config } from 'node-config-ts';

const DEFAULT_MERKLE_TREE_DEPTH_LIMIT = 10; // 1024 nodes in the tree by default

/**
 * Merkle tree structure
 */
export class MerkleTree<T> {
  private root: Node<T>;
  private leaves: Node<T>[];
  private readonly mergeFn: MergeFunction<T>;
  private readonly compareFn: CompareFunction<T> | undefined;
  private readonly depthLimit: number;

  /**
   * Default constructor
   * @param mergeFn
   * @param compareFn
   */
  constructor(mergeFn: MergeFunction<T>, compareFn?: CompareFunction<T>, depthLimit?: number) {
    this.mergeFn = mergeFn;
    this.compareFn = compareFn;
    this.depthLimit = depthLimit
  }

  /**
   * Initialize Merkle structure
   * @private
   */
  public async build(leaves: T[] | undefined): Promise<void> {
    if (!leaves || !leaves.length) {
      throw new Error('Cannot generate Merkle structure with no elements');
    }

    this.leaves = leaves.map((leaf) => new Node(leaf, null, null));
    if (this.compareFn) {
      this.leaves.sort(this.compareFn.compare);
    }
    this.root = await this._buildHelper(this.leaves);
  }

  /**
   * Get Merkle root node
   * @param elements - Sorted array of elements
   * @param treeDepth - Counter incremented with each recursive call that keeps tracks of the number
   *   of levels in the merkle tree
   * @returns root of the merkle tree for the given elements
   */
  private async _buildHelper(elements: Node<T>[], treeDepth = 0): Promise<Node<T>> {
    if (elements == null) {
      throw new Error('Cannot generate Merkle structure with no elements');
    }

    if (this.depthLimit && treeDepth > this.depthLimit) {
      const nodesLimit = Math.pow(2, this.depthLimit)
      throw new Error(`Merkle tree exceeded configured limit of ${this.depthLimit} levels (${nodesLimit} nodes)`)
    }

    if (elements.length === 1) {
      return elements[0];
    }

    const middleIndex = Math.trunc(elements.length / 2)
    const leftElements = elements.slice(0, middleIndex)
    const rightElements = elements.slice(middleIndex)
    const leftNode = await this._buildHelper(leftElements, treeDepth + 1)
    const rightNode = await this._buildHelper(rightElements, treeDepth + 1)
    const merged = await this.mergeFn.merge(leftNode, rightNode);
    leftNode.parent = merged
    rightNode.parent = merged
    return merged
  }

  /**
   * Get root element
   * @returns Node corresponding to the root of the merkle tree
   */
  public getRoot(): Node<T> {
    return this.root
  }

  /**
   * Gets leaves
   */
  public getLeaves(): T[] {
    return this.leaves.map(n => n.data);
  }

  /**
   * Testing-only method to inspect the raw leaf nodes of the tree
   * @private
   */
  public _getLeafNodes(): Node<T>[] {
    return this.leaves
  }

  /**
   * Get proof for particular element by index.  The proof is an array of nodes representing
   * the various subtrees that do *not* contain the given element. The idea is that
   * by repeatedly merging the element with successive nodes from the proof array, you eventually
   * should get the root node of the original merkle tree.
   * @param elemIndex - Element index
   * @returns Array of proof Nodes.
   */
  public async getProof(elemIndex: number): Promise<Node<T>[]> {
    return (await this._getProofHelper(this.leaves[elemIndex])).reverse()
  }

  private async _getProofHelper(elem: Node<T>): Promise<Node<T>[]> {
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
    return (await this._getDirectPathFromRootHelper(this.leaves[elemIndex]))
  }

  private async _getDirectPathFromRootHelper(elem: Node<T>) : Promise<PathDirection[]> {
    const parent = elem.parent
    if (!parent) {
      // We're at the root
      return []
    }

    const result = await this._getDirectPathFromRootHelper(parent)
    result.push(parent.left === elem ? PathDirection.L : PathDirection.R);
    return result
  }
}
