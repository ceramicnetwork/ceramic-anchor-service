import { assert } from 'chai';

import { MergeFunction, Node, CompareFunction } from '../merkle';
import { MerkleTree } from '../merkle-tree';

class StringConcat implements MergeFunction<string> {
  async merge(n1: Node<string>, n2: Node<string>): Promise<Node<string>> {
    return new Node(`Hash(${n1} + ${n2})`);
  }
}

// tslint:disable-next-line:max-classes-per-file
class StringCompare implements CompareFunction<string> {
  compare(n1: Node<string>, n2: Node<string>): number {
    return n1.data.localeCompare(n2.data);
  }
}

describe('Merkle tree layers tests',  () => {
  test('should handle null case', async () => {
    try {
      // tslint:disable-next-line:no-unused-expression
      const merkleTree = new MerkleTree<string>(new StringConcat());
      await merkleTree.build(null);

      assert.fail('Should not happen');
    } catch (e) {
      assert.equal(e.toString(), 'Error: Cannot generate Merkle structure with no elements');
    }
  });

  test('should handle the base case: [A]', async () => {
    const leaves = ['A'];
    const merkleTree = new MerkleTree<string>(new StringConcat());
    await merkleTree.build(leaves);

    assert.equal(merkleTree.getRoot().data, 'A');
  });

  test('should create a root from two leaves: [A,B]', async () => {
    const leaves = ['A', 'B'];
    const merkleTree = new MerkleTree<string>(new StringConcat());
    await merkleTree.build(leaves);

    assert.equal(merkleTree.getRoot().data, 'Hash(A + B)');
  });

  test('should create a root from four leaves: [A,B,C,D]', async () => {
    const leaves = ['A', 'B', 'C', 'D'];
    const merkleTree = new MerkleTree<string>(new StringConcat());
    await merkleTree.build(leaves);

    assert.equal(merkleTree.getRoot().data, 'Hash(Hash(A + B) + Hash(C + D))');
  });

  test('should create a root from four leaves: [B,D,A,C]', async () => {
    const leaves = ['B', 'D', 'A', 'C'];
    const merkleTree = new MerkleTree<string>(new StringConcat());
    await merkleTree.build(leaves);

    assert.equal(merkleTree.getRoot().data, 'Hash(Hash(B + D) + Hash(A + C))');
  });

  test('should create a root from four leaves (sorted): [B,D,A,C]', async () => {
    const leaves = ['B', 'D', 'A', 'C'];
    const merkleTree = new MerkleTree<string>(new StringConcat(), new StringCompare());
    await merkleTree.build(leaves);

    assert.equal(merkleTree.getRoot().data, 'Hash(Hash(A + B) + Hash(C + D))');
  });

  test('should create a root from three leaves: [A,B,C]', async () => {
    const leaves = ['A', 'B', 'C'];
    const merkleTree = new MerkleTree<string>(new StringConcat());
    await merkleTree.build(leaves);

    assert.equal(merkleTree.getRoot().data, 'Hash(Hash(A + B) + C)');
  });

  test('should create a root from five leaves: [A,B,C,D,E]', async () => {
    const leaves = ['A', 'B', 'C', 'D', 'E'];
    const merkleTree = new MerkleTree<string>(new StringConcat());
    await merkleTree.build(leaves);

    assert.equal(merkleTree.getRoot().data, 'Hash(Hash(Hash(A + B) + Hash(C + D)) + E)');
  });

  test('should create a root from seven leaves: [A,B,C,D,E,F,G]', async () => {
    const leaves = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const merkleTree = new MerkleTree<string>(new StringConcat());
    await merkleTree.build(leaves);

    assert.equal(merkleTree.getRoot().data, 'Hash(Hash(Hash(A + B) + Hash(C + D)) + Hash(Hash(E + F) + G))');
  });
});
