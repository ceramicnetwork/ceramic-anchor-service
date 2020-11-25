import { Node } from './merkle';

/**
 * One proof part of the Merkle tree
 */
export default class Proof<T> {
  constructor(public node: Node<T>) {
    // empty constructor
  }
}
