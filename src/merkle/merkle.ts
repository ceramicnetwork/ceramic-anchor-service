import CID from 'cids';

interface MergeFunction<T, M> {
  /**
   * Merges two nodes
   * @param n1 - object1
   * @param n2 - object2
   * @param metadata - optional tree metadata, generally only given when building the root node.
   */
  merge(n1: Node<T>, n2: Node<T>, metadata: M | null): Promise<Node<T>>;
}

interface CompareFunction<T> {
  /**
   * Compares two Merkle nodes
   * @param n1
   * @param n2
   */
  compare(n1: Node<T>, n2: Node<T>): number;
}

interface MetadataFunction<T, M> {
  /**
   * Generates the tree metadata from the leaf nodes
   * @param leafNodes
   */
  generateMetadata(leafNodes: Array<Node<T>>): M;
}

/**
 * Interface of one Merkle node
 */
class Node<T> {
  public parent?: Node<T>;

  constructor(public data: T, public left: Node<T>, public right: Node<T>) {}

  public toString = (): string => {
    return '' + this.data;
  };
}

/**
 * Path direction from the Merkle root node
 */
enum PathDirection {
  L,
  R,
}

export { Node, MergeFunction, CompareFunction, MetadataFunction, PathDirection };

/**
 * todo
 */
interface BloomMetadata {
  type: string;
  data: any;
}

/**
 * todo
 */
export interface TreeMetadata {
  numEntries: number;
  bloomFilter: BloomMetadata;
}