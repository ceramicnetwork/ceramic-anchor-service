import { MergeFunction, Node } from '../merkle.js'
import { MerkleTree } from '../merkle-tree.js'

class StringConcat implements MergeFunction<string, string> {
  async merge(n1: Node<string>, n2: Node<string>, m: string | null): Promise<Node<string>> {
    if (m) {
      return new Node(`Hash(${n1} + ${n2} + Metadata(${m}))`, n1, n2)
    } else {
      return new Node(`Hash(${n1} + ${n2})`, n1, n2)
    }
  }
}

const leaves: string[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']
let tree: MerkleTree<string, string, string>

describe('Merkle tree proof verification', () => {
  beforeAll(async (done) => {
    tree = new MerkleTree<string, string, string>(new StringConcat())
    await tree.build(leaves)
    done()
  })

  describe('a given merkle tree', () => {
    describe('untampered proofs', () => {
      test.each(leaves)(`should verify the proof for leaf index %p`, async (leaf) => {
        const index = leaves.indexOf(leaf)
        const proof = await tree.getProof(index)
        const verified = await tree.verifyProof(proof, leaves[index])
        expect(verified).toBeTruthy()
      })
    })

    describe('tampered proofs', () => {
      describe('verifying a different node with a proof', () => {
        test('should not verify the proof', async () => {
          const proof = await tree.getProof(2)
          const verified = await tree.verifyProof(proof, leaves[3])
          expect(verified).toBeFalsy()
        })
      })
    })
  })
})
