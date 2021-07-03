import { CompareFunction, MergeFunction, MetadataFunction, Node, PathDirection, TreeMetadata } from './merkle';

/**
 * Merkle tree structure.
 * Type 'N' is the type of the nodes in the tree. Type 'L' is the type of the leaf nodes specifically,
 * which may be a more specific sub-type of 'N'. Type 'M' is the type of the metadata.
 */
export class MerkleTree<N, L extends N, M> {
  private root: Node<N>;
  private leaves: Node<L>[];
  private metadata: M;
  private readonly mergeFn: MergeFunction<N, M>;
  private readonly compareFn: CompareFunction<L> | undefined;
  private readonly metadataFn: MetadataFunction<L, M> | undefined;
  private readonly depthLimit: number;

  /**
   * Default constructor
   * @param mergeFn - fn that merges nodes at lower levels to produce nodes for higher levels of the tree
   * @param compareFn - fn for sorting the leaves before building the tree
   * @param metadataFn - fn for generating the tree metadata from the leaves
   * @param depthLimit - limit to the number of levels the tree is allowed to have
   */
  constructor(mergeFn: MergeFunction<N, M>, compareFn?: CompareFunction<L>, metadataFn?: MetadataFunction<L, M>, depthLimit?: number) {
    this.mergeFn = mergeFn;
    this.compareFn = compareFn;
    this.metadataFn = metadataFn;
    this.depthLimit = depthLimit;
  }

  /**
   * Initialize Merkle structure
   * @private
   */
  public async build(leaves: L[] | undefined): Promise<void> {
    if (!leaves || !leaves.length) {
      throw new Error('Cannot generate Merkle structure with no elements');
    }

    this.leaves = leaves.map((leaf) => new Node(leaf, null, null));
    if (this.compareFn) {
      this.leaves.sort(this.compareFn.compare);
    }

    this.metadata = this.metadataFn ? await this.metadataFn.generateMetadata(this.leaves) : null

    this.root = await this._buildHelper(this.leaves, 0, this.metadata);
  }

  /**
   * Get Merkle root node
   * @param elements - Sorted array of elements
   * @param treeDepth - Counter incremented with each recursive call that keeps tracks of the number
   *   of levels in the merkle tree
   * @param treeMetadata - metadata to add to merged node.  Should only be set for the root level.
   * @returns root of the merkle tree for the given elements
   */
  private async _buildHelper(elements: Node<N>[], treeDepth: number, treeMetadata: M): Promise<Node<N>> {
    if (elements == null) {
      throw new Error('Cannot generate Merkle structure with no elements');
    }

    if (this.depthLimit > 0 && treeDepth > this.depthLimit) {
      const nodesLimit = Math.pow(2, this.depthLimit)
      throw new Error(`Merkle tree exceeded configured limit of ${this.depthLimit} levels (${nodesLimit} nodes)`)
    }

    if (elements.length === 1) {
      return elements[0];
    }

    const middleIndex = Math.trunc(elements.length / 2)
    const leftElements = elements.slice(0, middleIndex)
    const rightElements = elements.slice(middleIndex)
    const leftNode = await this._buildHelper(leftElements, treeDepth + 1, null)
    const rightNode = await this._buildHelper(rightElements, treeDepth + 1, null)
    const merged = await this.mergeFn.merge(leftNode, rightNode, treeMetadata);
    leftNode.parent = merged
    rightNode.parent = merged
    return merged
  }

  /**
   * Get root element
   * @returns Node corresponding to the root of the merkle tree
   */
  public getRoot(): Node<N> {
    return this.root
  }

  /**
   * Gets leaves
   */
  public getLeaves(): L[] {
    return this.leaves.map(n => n.data);
  }

  /**
   * Gets tree metadata
   */
  public getMetadata(): M {
    return this.metadata
  }

  /**
   * Testing-only method to inspect the raw leaf nodes of the tree
   * @private
   */
  public _getLeafNodes(): Node<L>[] {
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
  public async getProof(elemIndex: number): Promise<Node<N>[]> {
    return (await this._getProofHelper(this.leaves[elemIndex])).reverse()
  }

  private async _getProofHelper(elem: Node<L>): Promise<Node<N>[]> {
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
  public async verifyProof(proof: Node<N>[], element: any): Promise<boolean> {
    let current = new Node(element, null, null);
    for (const p of proof) {
      const left = p.parent.left == p
      const isRoot = p == proof[proof.length - 1]
      const metadata = isRoot ? this.metadata : null
      if (left) {
        current = await this.mergeFn.merge(p, current, metadata);
      } else {
        current = await this.mergeFn.merge(current, p, metadata);
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

  private async _getDirectPathFromRootHelper(elem: Node<N>) : Promise<PathDirection[]> {
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
