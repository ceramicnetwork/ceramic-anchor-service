export interface MergeFunction<N, M> {
  /**
   * Merges two nodes
   * @param n1 - object1
   * @param n2 - object2
   * @param metadata - optional tree metadata, generally only given when building the root node.
   */
  merge(n1: Node<N>, n2: Node<N>, metadata: M | null): Promise<Node<N>>
}

export interface CompareFunction<L> {
  /**
   * Compares two Merkle leaf nodes
   * @param n1
   * @param n2
   */
  compare(n1: Node<L>, n2: Node<L>): number
}

export interface MetadataFunction<L, M> {
  /**
   * Generates the tree metadata from the leaf nodes
   * @param leafNodes
   */
  generateMetadata(leafNodes: Array<Node<L>>): M
}

/**
 * Interface of one Merkle node
 */
export class Node<N> {
  parent?: Node<N>

  constructor(readonly data: N, readonly left: Node<N>, readonly right: Node<N>) {}

  toString = (): string => {
    return '' + this.data
  }
}

/**
 * Path direction from the Merkle root node
 */
export enum PathDirection {
  L = 0,
  R = 1,
}

/**
 * Metadata containing a bloom filter based on the metadata of the streams in the tree
 */
export interface BloomMetadata {
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
