import { assert } from 'chai';
import { describe, it } from 'mocha';

import { MergeFunction, Node } from '../merkle';
import { MerkleTree } from '../merkle-tree';

class StringConcat implements MergeFunction<string> {
  async merge(n1: Node<string>, n2: Node<string>): Promise<Node<string>> {
    return new Node(`Hash(${n1} + ${n2})`);
  }
}
describe('Merkle tree proof verification', async () => {
  describe('a given merkle tree', async () => {
    const leaves = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
    const tree = new MerkleTree<string>(new StringConcat());
    await tree.build(leaves);

    describe('untampered proofs', async () => {
      leaves.forEach((_, i) => {
        it(`should verify the proof for leaf index ${i}`, async () => {
          const proof = tree.getProof(i);
          const verified = await tree.verifyProof(proof, leaves[i]);
          assert.equal(verified, true);
        });
      });
    });

    describe('tampered proofs', () => {
      describe('verifying a different node with a proof', async () => {
        it('should not verify the proof', async () => {
          const proof = tree.getProof(2);
          const verified = await tree.verifyProof(proof, leaves[3]);
          assert.equal(verified, false);
        });
      });
    });
  });
});
