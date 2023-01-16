import { MergeFunction, Node, PathDirection } from './merkle.js'

/**
 * Merkle tree structure.
 * Type 'TData' is the type of the nodes in the tree. Type 'TLeaf' is the type of the leaf nodes specifically,
 * which may be a more specific sub-type of 'TData'. Type 'TMetadata' is the type of the metadata.
 */
export class MerkleTree<TData, TLeaf extends TData, TMetadata> {
  /**
   * @param mergeFn - fn that merges nodes at lower levels to produce nodes for higher levels of the tree
   * @param root
   * @param leaves
   * @param metadata
   */
  constructor(
    private readonly mergeFn: MergeFunction<TData, TMetadata>,
    private readonly root: Node<TData>,
    private readonly leaves: Array<Node<TLeaf>>,
    private readonly metadata: TMetadata
  ) {}

  /**
   * Get root element
   * @returns Node corresponding to the root of the merkle tree
   */
  getRoot(): Node<TData> {
    return this.root
  }

  /**
   * Gets leaves
   */
  getLeaves(): TLeaf[] {
    return this.leaves.map((n) => n.data)
  }

  /**
   * Gets tree metadata
   */
  getMetadata(): TMetadata {
    return this.metadata
  }

  /**
   * Testing-only method to inspect the raw leaf nodes of the tree
   * @private
   */
  _getLeafNodes(): Node<TLeaf>[] {
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
  async getProof(elemIndex: number): Promise<Node<TData>[]> {
    return (await this._getProofHelper(this.leaves[elemIndex])).reverse()
  }

  private async _getProofHelper(elem: Node<TLeaf>): Promise<Node<TData>[]> {
    const parent = elem.parent
    if (!parent) {
      // We're at the root
      return []
    }

    const result = await this._getProofHelper(parent)

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
  async verifyProof(proof: Node<TData>[], element: any): Promise<boolean> {
    let current = new Node(element, null, null)
    for (const p of proof) {
      const left = p.parent.left == p
      const isRoot = p == proof[proof.length - 1]
      const metadata = isRoot ? this.metadata : null
      if (left) {
        current = await this.mergeFn.merge(p, current, metadata)
      } else {
        current = await this.mergeFn.merge(current, p, metadata)
      }
    }
    return this.getRoot().data === current.data
  }

  /**
   * Get direct path for particular element by index
   * @param elemIndex - Element index
   * @returns Array of PathDirection objects representing the path from the root of the tree to
   * the element requested
   */
  async getDirectPathFromRoot(elemIndex: number): Promise<PathDirection[]> {
    return await this._getDirectPathFromRootHelper(this.leaves[elemIndex])
  }

  private async _getDirectPathFromRootHelper(elem: Node<TData>): Promise<PathDirection[]> {
    const parent = elem.parent
    if (!parent) {
      // We're at the root
      return []
    }

    const result = await this._getDirectPathFromRootHelper(parent)
    result.push(parent.left === elem ? PathDirection.L : PathDirection.R)
    return result
  }
}
