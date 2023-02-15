import { describe, test, expect } from '@jest/globals'
import { PathDirection, pathString } from '../merkle-elements.js'
import { MerkleTreeFactory } from '../merkle-tree-factory.js'
import { StringConcat } from './string-concat.js'
import { path } from './path.util.js'
import { pathByIndex } from '../merkle-tree.js'

const factory = new MerkleTreeFactory<string, string, string>(new StringConcat())

describe('Merkle tree direct path tests', () => {
  test('should handle the case: [A]', async () => {
    const leaves = ['A']
    const merkleTree = await factory.build(leaves)
    const directPath = merkleTree.getDirectPathFromRoot(0)
    expect(directPath).toStrictEqual(path`L`)
    expect(directPath).toStrictEqual(pathByIndex(0, merkleTree.leafNodes.length))
    expect(pathString(directPath)).toStrictEqual('0')
  })

  test('should handle the case: [A]', async () => {
    const leaves = ['A', 'B', 'C', 'D']
    const merkleTree = await factory.build(leaves)

    const directPath = merkleTree.getDirectPathFromRoot(0)
    expect(directPath).toStrictEqual(path`L/L`)
    expect(directPath).toStrictEqual(pathByIndex(0, merkleTree.leafNodes.length))
    expect(pathString(directPath)).toStrictEqual('0/0')
  })

  test('should handle the case: [A]', async () => {
    const leaves = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const merkleTree = await factory.build(leaves)

    const directPath = merkleTree.getDirectPathFromRoot(0)
    expect(directPath).toStrictEqual(path`L/L/L`)
    expect(directPath).toStrictEqual(pathByIndex(0, merkleTree.leafNodes.length))
    expect(pathString(directPath)).toStrictEqual('0/0/0')
  })

  test('should handle the case: [B]', async () => {
    const leaves = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const merkleTree = await factory.build(leaves)

    const directPath = merkleTree.getDirectPathFromRoot(1)
    // expect(directPath).toStrictEqual([PathDirection.L, PathDirection.L, PathDirection.R])
    expect(directPath).toStrictEqual(path`L/L/R`)
    expect(directPath).toStrictEqual(pathByIndex(1, merkleTree.leafNodes.length))
    expect(pathString(directPath)).toStrictEqual('0/0/1')
  })

  test('should handle the case: [H]', async () => {
    const leaves = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const merkleTree = await factory.build(leaves)

    const directPath = merkleTree.getDirectPathFromRoot(7)
    expect(directPath).toStrictEqual(path`R/R/R`)
    expect(directPath).toStrictEqual(pathByIndex(7, merkleTree.leafNodes.length))
    expect(pathString(directPath)).toStrictEqual('1/1/1')
  })

  test('should handle the case: [G]', async () => {
    const leaves = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const merkleTree = await factory.build(leaves)

    const directPath = merkleTree.getDirectPathFromRoot(6)
    expect(directPath).toStrictEqual([PathDirection.R, PathDirection.R, PathDirection.L])
    expect(directPath).toStrictEqual(path`R/R/L`)
    expect(directPath).toStrictEqual(pathByIndex(6, merkleTree.leafNodes.length))
    expect(pathString(directPath)).toStrictEqual('1/1/0')
  })

  test('should handle the case: [J]', async () => {
    const leaves = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J']
    const merkleTree = await factory.build(leaves)

    const directPath = merkleTree.getDirectPathFromRoot(8)
    expect(directPath).toStrictEqual(path`R/R/R/R`)
    expect(directPath).toStrictEqual(pathByIndex(8, merkleTree.leafNodes.length))
    expect(pathString(directPath)).toStrictEqual('1/1/1/1')
  })
})
