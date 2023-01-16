import * as crypto from 'crypto'
import { MergeFunction, Node } from '../merkle.js'
import type { MerkleTree } from '../merkle-tree.js'
import { MerkleTreeFactory } from '../merkle-tree-factory.js'
import { StringConcat } from './string-concat.js'

// use the crypto module to create a sha256 hash from the node passed in
const sha256 = (data: any): Uint8Array => {
  return crypto.createHash('sha256').update(data).digest()
}

// tslint:disable-next-line:max-classes-per-file
class HashConcat implements MergeFunction<Uint8Array, Uint8Array> {
  async merge(
    n1: Node<Uint8Array>,
    n2: Node<Uint8Array>,
    m: Uint8Array | null
  ): Promise<Node<Uint8Array>> {
    if (!n1) {
      throw new Error('The concat function expects two hash arguments, the first was not received.')
    }
    if (!n2) {
      throw new Error(
        'The concat function expects two hash arguments, the second was not received.'
      )
    }
    const elems = [n1.data, n2.data]
    if (m) {
      elems.push(m)
    }
    return new Node(sha256(Buffer.concat(elems)), n1, n2)
  }
}

// given a proof, finds the merkle root
const hashProof = (value: any, proof: Node<Uint8Array>[]): any => {
  let data: Uint8Array = sha256(value)
  for (let i = 0; i < proof.length; i++) {
    let buffers: Uint8Array[]
    const left = proof[i].parent.left === proof[i]
    if (left) {
      buffers = new Array<Uint8Array>(proof[i].data, data)
    } else {
      buffers = new Array<Uint8Array>(data, proof[i].data)
    }
    data = sha256(Buffer.concat(buffers))
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
    hashTree = await hashTreeFactory.build(leaves.map(sha256))
    lettersTree = await lettersTreeFactory.build(leaves)
  })

  describe('for each leaf', () => {
    test.each(leaves)(
      `should return a proof that calculates the root from leaf %p`,
      async (leaf) => {
        const i = leaves.indexOf(leaf)
        const proof = await hashTree.getProof(i)
        const hashedProof = hashProof(leaf, proof).toString('hex')
        if (hashedProof !== root) {
          const lettersProof = await lettersTree.getProof(i)
          // tslint:disable-next-line:no-console
          console.log(
            'The resulting hash of your proof is wrong. \n' +
              `We were expecting: ${root} \n` +
              `We received: ${hashedProof} \n` +
              `In ${leaves.join('')} Merkle tree, the proof of ${leaves[i]} you gave us is: \n` +
              lettersProof.map((node) => node.data).join('->')
          )
        }

        expect(hashedProof).toStrictEqual(root)
      }
    )
  })
})
