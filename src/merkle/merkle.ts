interface MergeFunction<N, M> {
  /**
   * Merges two nodes
   * @param n1 - object1
   * @param n2 - object2
   * @param metadata - optional tree metadata, generally only given when building the root node.
   */
  merge(n1: Node<N>, n2: Node<N>, metadata: M | null): Promise<Node<N>>
}

interface CompareFunction<L> {
  /**
   * Compares two Merkle leaf nodes
   * @param n1
   * @param n2
   */
  compare(n1: Node<L>, n2: Node<L>): number
}

interface MetadataFunction<L, M> {
  /**
   * Generates the tree metadata from the leaf nodes
   * @param leafNodes
   */
  generateMetadata(leafNodes: Array<Node<L>>): M
}

/**
 * Interface of one Merkle node
 */
class Node<N> {
  public parent?: Node<N>

  constructor(public data: N, public left: Node<N>, public right: Node<N>) {}

  public toString = (): string => {
    return '' + this.data
  }
}

/**
 * Path direction from the Merkle root node
 */
enum PathDirection {
  L,
  R,
}

export { Node, MergeFunction, CompareFunction, MetadataFunction, PathDirection }

/**
 * Metadata containing a bloom filter based on the metadata of the streams in the tree
 */
interface BloomMetadata {
  type: string
  data: any
}

/**
 * Metadata related to the merkle tree
 */
export interface TreeMetadata {
  numEntries: number
  bloomFilter: BloomMetadata
  streamIds: string[]
}
