import { describe, test, expect, beforeAll } from '@jest/globals'
import { MergeFunction, Node } from '../merkle.js'
import type { MerkleTree } from '../merkle-tree.js'
import { MerkleTreeFactory } from '../merkle-tree-factory.js'
import { StringConcat } from './string-concat.js'
import { expectPresent } from '../../__tests__/expect-present.util.js'
import * as uint8arrays from 'uint8arrays'
import { hash as sha256 } from '@stablelib/sha256'

class HashConcat implements MergeFunction<Uint8Array, Uint8Array> {
  async merge(
    n1: Node<Uint8Array>,
    n2: Node<Uint8Array>,
    m: Uint8Array | null
  ): Promise<Node<Uint8Array>> {
    const elems = [n1.data, n2.data]
    if (m) elems.push(m)
    return new Node(sha256(uint8arrays.concat(elems)), n1, n2)
  }
}

// given a proof, finds the merkle root
function hashProof(value: string, proof: Node<Uint8Array>[]): Uint8Array {
  let data = sha256(uint8arrays.fromString(value))
  for (let i = 0; i < proof.length; i++) {
    let buffers: Uint8Array[]
    const element = proof[i]
    expectPresent(element)
    const left = element.parent?.left === proof[i]
    if (left) {
      buffers = [element.data, data]
    } else {
      buffers = [data, element.data]
    }
    data = sha256(uint8arrays.concat(buffers))
  }
  return data
}

const leaves: string[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
let lettersTree: MerkleTree<string, string, string>
let hashTree: MerkleTree<Uint8Array, Uint8Array, Uint8Array>

const root = '1b0e895690b99d3bb2138f5ea55424f004901039763c420bc126ec8aa3bbca39'

const hashTreeFactory = new MerkleTreeFactory<Uint8Array, Uint8Array, Uint8Array>(new HashConcat())
const lettersTreeFactory = new MerkleTreeFactory<string, string, string>(new StringConcat())

describe('Merkle tree proofs tests', () => {
  beforeAll(async () => {
    hashTree = await hashTreeFactory.build(
      leaves.map((leaf) => sha256(uint8arrays.fromString(leaf)))
    )
    lettersTree = await lettersTreeFactory.build(leaves)
  })

  describe('for each leaf', () => {
    test.each(leaves)(`should return a proof that calculates the root from leaf %p`, (leaf) => {
      const i = leaves.indexOf(leaf)
      const proof = hashTree.getProof(i)
      const hashedProof = uint8arrays.toString(hashProof(leaf, proof), 'hex')
      if (hashedProof !== root) {
        const lettersProof = lettersTree.getProof(i)
        console.log(
          'The resulting hash of your proof is wrong. \n' +
            `We were expecting: ${root} \n` +
            `We received: ${hashedProof} \n` +
            `In ${leaves.join('')} Merkle tree, the proof of ${leaves[i]} you gave us is: \n` +
            lettersProof.map((node) => node.data).join('->')
        )
      }

      expect(hashedProof).toEqual(root)
    })
  })
})
