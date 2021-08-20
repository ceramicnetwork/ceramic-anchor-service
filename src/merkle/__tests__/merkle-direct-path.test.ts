import { Node, PathDirection, MergeFunction } from '../merkle'
import { MerkleTree } from '../merkle-tree'

class StringConcat implements MergeFunction<string, string> {
  async merge(n1: Node<string>, n2: Node<string>, m: string | null): Promise<Node<string>> {
    if (m) {
      return new Node(`Hash(${n1} + ${n2} + Metadata(${m}))`, n1, n2)
    } else {
      return new Node(`Hash(${n1} + ${n2})`, n1, n2)
    }
  }
}

describe('Merkle tree direct path tests', () => {
  test('should handle the case: [A]', async () => {
    const leaves = ['A']
    const merkleTree = new MerkleTree<string, string, string>(new StringConcat())
    await merkleTree.build(leaves)

    const directPath = await merkleTree.getDirectPathFromRoot(0)
    expect(directPath).toStrictEqual([])
  })

  test('should handle the case: [A]', async () => {
    const leaves = ['A', 'B', 'C', 'D']
    const merkleTree = new MerkleTree<string, string, string>(new StringConcat())
    await merkleTree.build(leaves)

    const directPath = await merkleTree.getDirectPathFromRoot(0)
    expect(directPath).toStrictEqual([PathDirection.L, PathDirection.L])
  })

  test('should handle the case: [A]', async () => {
    const leaves = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const merkleTree = new MerkleTree<string, string, string>(new StringConcat())
    await merkleTree.build(leaves)

    const directPath = await merkleTree.getDirectPathFromRoot(0)
    expect(directPath).toStrictEqual([PathDirection.L, PathDirection.L, PathDirection.L])
  })

  test('should handle the case: [B]', async () => {
    const leaves = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const merkleTree = new MerkleTree<string, string, string>(new StringConcat())
    await merkleTree.build(leaves)

    const directPath = await merkleTree.getDirectPathFromRoot(1)
    expect(directPath).toStrictEqual([PathDirection.L, PathDirection.L, PathDirection.R])
  })

  test('should handle the case: [H]', async () => {
    const leaves = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const merkleTree = new MerkleTree<string, string, string>(new StringConcat())
    await merkleTree.build(leaves)

    const directPath = await merkleTree.getDirectPathFromRoot(7)
    expect(directPath).toStrictEqual([PathDirection.R, PathDirection.R, PathDirection.R])
  })

  test('should handle the case: [G]', async () => {
    const leaves = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const merkleTree = new MerkleTree<string, string, string>(new StringConcat())
    await merkleTree.build(leaves)

    const directPath = await merkleTree.getDirectPathFromRoot(6)
    expect(directPath).toStrictEqual([PathDirection.R, PathDirection.R, PathDirection.L])
  })

  test('should handle the case: [J]', async () => {
    const leaves = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J']
    const merkleTree = new MerkleTree<string, string, string>(new StringConcat())
    await merkleTree.build(leaves)

    const directPath = await merkleTree.getDirectPathFromRoot(8)
    expect(directPath).toStrictEqual([
      PathDirection.R,
      PathDirection.R,
      PathDirection.R,
      PathDirection.R,
    ])
  })
})
