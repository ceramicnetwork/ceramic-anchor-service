import type { CompareFunction, MergeFunction, MetadataFunction } from './merkle.js'
import { Node } from './merkle.js'
import type { NonEmptyArray } from '@ceramicnetwork/common'
import { MerkleTree } from './merkle-tree.js'

export class EmptyLeavesError extends Error {
  constructor() {
    super('Cannot generate Merkle structure with no elements')
  }
}

// FIXME Rename TData, TLeaf, TMetadata
export class MerkleTreeFactory<TData, TLeaf extends TData, TMetadata> {
  /**
   * @param mergeFn - fn that merges nodes at lower levels to produce nodes for higher levels of the tree
   * @param compareFn - fn for sorting the leaves before building the tree
   * @param metadataFn - fn for generating the tree metadata from the leaves
   * @param depthLimit - limit to the number of levels the tree is allowed to have
   */
  constructor(
    private readonly mergeFn: MergeFunction<TData, TMetadata>,
    private readonly compareFn?: CompareFunction<TLeaf>,
    private readonly metadataFn?: MetadataFunction<TLeaf, TMetadata>,
    private readonly depthLimit?: number
  ) {}

  async build(leaves?: Array<TLeaf>): Promise<MerkleTree<TData, TLeaf, TMetadata>> {
    if (!leaves || !leaves.length) throw new EmptyLeavesError()

    const nodes = leaves.map((leaf) => new Node(leaf, null, null)) as NonEmptyArray<Node<TLeaf>>
    if (this.compareFn) {
      nodes.sort(this.compareFn.compare)
    }

    const metadata = this.metadataFn ? await this.metadataFn.generateMetadata(nodes) : null

    const root = await this._buildHelper(nodes, 0, metadata)
    return new MerkleTree<TData, TLeaf, TMetadata>(this.mergeFn, root, nodes, metadata)
  }

  private async _buildHelper(
    elements: Node<TData>[],
    treeDepth: number,
    treeMetadata: TMetadata
  ): Promise<Node<TData>> {
    // FIXME Can be calculated at the start
    if (this.depthLimit > 0 && treeDepth > this.depthLimit) {
      const nodesLimit = Math.pow(2, this.depthLimit)
      throw new Error(
        `Merkle tree exceeded configured limit of ${this.depthLimit} levels (${nodesLimit} nodes)`
      )
    }

    // if there is only one leaf for the whole tree
    if (elements.length === 1 && treeDepth === 0) {
      const merged = await this.mergeFn.merge(elements[0], null, treeMetadata)
      elements[0].parent = merged
      return merged
    }

    if (elements.length === 1) {
      return elements[0]
    }

    const middleIndex = Math.trunc(elements.length / 2)
    const leftElements = elements.slice(0, middleIndex)
    const rightElements = elements.slice(middleIndex)
    const leftNode = await this._buildHelper(leftElements, treeDepth + 1, null)
    const rightNode = await this._buildHelper(rightElements, treeDepth + 1, null)
    const merged = await this.mergeFn.merge(leftNode, rightNode, treeMetadata)
    leftNode.parent = merged
    rightNode.parent = merged
    return merged
  }
}
