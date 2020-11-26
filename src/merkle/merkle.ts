interface MergeFunction<T> {
  /**
   * Merges two nodes
   * @param n1 - object1
   * @param n2 - object2
   */
  merge(n1: Node<T>, n2: Node<T>): Promise<Node<T>>;
}

interface CompareFunction<T> {
  /**
   * Compares two Merkle nodes
   * @param n1
   * @param n2
   */
  compare(n1: Node<T>, n2: Node<T>): number;
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

export { Node, MergeFunction, CompareFunction, PathDirection };
