import { MergeFunction, Node, CompareFunction } from '../merkle';
import { MerkleTree } from '../merkle-tree';

class StringConcat implements MergeFunction<string> {
  async merge(n1: Node<string>, n2: Node<string>): Promise<Node<string>> {
    return new Node(`Hash(${n1} + ${n2})`, n1, n2);
  }
}

// tslint:disable-next-line:max-classes-per-file
class StringCompare implements CompareFunction<string> {
  compare(n1: Node<string>, n2: Node<string>): number {
    return n1.data.localeCompare(n2.data);
  }
}

describe('Merkle tree structure tests',  () => {
  test('should handle null case', async () => {
    try {
      // tslint:disable-next-line:no-unused-expression
      const merkleTree = new MerkleTree<string>(new StringConcat());
      await merkleTree.build(null);

      expect(false).toBe(true);
    } catch (e) {
      expect(e.toString()).toBe('Error: Cannot generate Merkle structure with no elements');
    }
  });

  test('Enforces depth limit', async () => {
    // No problem building with limit so long as there are fewer than 2^limit nodes
    const merkleTree = new MerkleTree<string>(new StringConcat(), undefined, 2);
    await merkleTree.build(['A', 'B', 'C', 'D']);

    expect(merkleTree.getRoot().data).toBe("Hash(Hash(A + B) + Hash(C + D))");

    // Fails to build when there are more nodes than can fit within the depth limit
    const merkleTree2 = new MerkleTree<string>(new StringConcat(), undefined, 2);
    await expect(merkleTree2.build(['A', 'B', 'C', 'D', 'E'])).rejects.toThrow("Merkle tree exceeded configured limit of 2 levels (4 nodes)");
  });

  test('should handle the base case: [A]', async () => {
    const leaves = ['A'];
    const merkleTree = new MerkleTree<string>(new StringConcat());
    await merkleTree.build(leaves);

    expect(merkleTree.getRoot().data).toBe('A');
  });

  test('should create a root from two leaves: [A,B]', async () => {
    const leaves = ['A', 'B'];
    const merkleTree = new MerkleTree<string>(new StringConcat());
    await merkleTree.build(leaves);

    expect(merkleTree.getRoot().data).toBe('Hash(A + B)');
  });

  test('should create a root from four leaves: [A,B,C,D]', async () => {
    const leaves = ['A', 'B', 'C', 'D'];
    const merkleTree = new MerkleTree<string>(new StringConcat());
    await merkleTree.build(leaves);

    expect(merkleTree.getRoot().data).toBe('Hash(Hash(A + B) + Hash(C + D))');
  });

  test('should create a root from four leaves: [B,D,A,C]', async () => {
    const leaves = ['B', 'D', 'A', 'C'];
    const merkleTree = new MerkleTree<string>(new StringConcat());
    await merkleTree.build(leaves);

    expect(merkleTree.getRoot().data).toBe('Hash(Hash(B + D) + Hash(A + C))');
  });

  test('should create a root from four leaves (sorted): [B,D,A,C]', async () => {
    const leaves = ['B', 'D', 'A', 'C'];
    const merkleTree = new MerkleTree<string>(new StringConcat(), new StringCompare());
    await merkleTree.build(leaves);

    expect(merkleTree.getRoot().data).toBe('Hash(Hash(A + B) + Hash(C + D))');
  });

  test('should create a root from three leaves: [A,B,C]', async () => {
    const leaves = ['A', 'B', 'C'];
    const merkleTree = new MerkleTree<string>(new StringConcat());
    await merkleTree.build(leaves);

    expect(merkleTree.getRoot().data).toBe('Hash(A + Hash(B + C))');
  });

  test('should create a root from five leaves: [A,B,C,D,E]', async () => {
    const leaves = ['A', 'B', 'C', 'D', 'E'];
    const merkleTree = new MerkleTree<string>(new StringConcat());
    await merkleTree.build(leaves);

    expect(merkleTree.getRoot().data).toBe('Hash(Hash(A + B) + Hash(C + Hash(D + E)))');
  });

  test('should create a root from six leaves: [A,B,C,D,E,F]', async () => {
    const leaves = ['A', 'B', 'C', 'D', 'E', 'F'];
    const merkleTree = new MerkleTree<string>(new StringConcat());
    await merkleTree.build(leaves);

    expect(merkleTree.getRoot().data).toBe('Hash(Hash(A + Hash(B + C)) + Hash(D + Hash(E + F)))');
  });

  test('should create a root from seven leaves: [A,B,C,D,E,F,G]', async () => {
    const leaves = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const merkleTree = new MerkleTree<string>(new StringConcat());
    await merkleTree.build(leaves);

    expect(merkleTree.getRoot().data).toBe('Hash(Hash(A + Hash(B + C)) + Hash(Hash(D + E) + Hash(F + G)))');
  });
});

const findNodeDepth = async (node: Node<any>): Promise<number> => {
  if (!node) {
    return 0
  }

  let depth = 0
  while (node) {
    node = node.parent
    depth++
  }
  return depth
};

const findMinAndMaxNodeDepth = async(tree: MerkleTree<any>): Promise<[number, number]> => {
  let minDepth = tree.getLeaves().length
  let maxDepth = 0

  for (const node of tree._getLeafNodes()) {
    const depth = await findNodeDepth(node)
    if (depth < minDepth) {
      minDepth = depth
    }
    if (depth > maxDepth) {
      maxDepth = depth
    }
  }
  return [minDepth, maxDepth]
}

describe('Merkle tree balance test',  () => {
  test('Tree should be balanced', async () => {
    const inputs = []
    for (let i = 1; i < 100; i++) {
      // Create an array of numbers from 0-i in increasing order
      const arr = Array.from(Array(i).keys())
      inputs.push(arr.map(i => i.toString()))
    }

    for (const leaves of inputs) {
      const merkleTree = new MerkleTree<string>(new StringConcat());
      await merkleTree.build(leaves);

      const [minDepth, maxDepth] = await findMinAndMaxNodeDepth(merkleTree)
      // There shouldn't be more than 1 level difference between the deepest and shallowest nodes in the tree
      expect(maxDepth - minDepth).toBeLessThanOrEqual(1)
    }
  });
});
