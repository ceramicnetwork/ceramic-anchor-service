import { CidGenerator, MockIpfsService } from '../../test-utils';
import { MerkleTree } from '../merkle-tree';
import { TreeMetadata } from '../merkle';
import { BloomMetadata, Candidate, IpfsLeafCompare, IpfsMerge } from '../merkle-objects';
import DocID from '@ceramicnetwork/docid';
import bloom from 'bloomfilter.js';

describe('Bloom filter',  () => {
  jest.setTimeout(10000);
  const cidGenerator = new CidGenerator()
  const ipfsService = new MockIpfsService(cidGenerator)

  beforeEach(async () => {
    cidGenerator.reset()
    ipfsService.reset()
  });

  const createCandidate = function (metadata: any) {
    const cid = cidGenerator.next()
    const doc = { id: new DocID('tile', cid), metadata }
    return new Candidate(cid, 0, doc as any)
  }

  test('Single document minimal metadata', async () => {
    const merkleTree = new MerkleTree<Candidate, TreeMetadata>(new IpfsMerge(ipfsService), new IpfsLeafCompare(), new BloomMetadata())
    const candidates = [createCandidate({controllers: ["a"]})]
    await merkleTree.build(candidates)
    const metadata = merkleTree.getMetadata()
    expect(metadata.numEntries).toEqual(1)
    expect(metadata.bloomFilter.type).toEqual("jsnpm_bloomfilter.js")

    const bloomFilter = bloom.deserialize(metadata.bloomFilter.data)

    expect(bloomFilter.test(`docid-${candidates[0].document.id.baseID.toString()}`)).toBeTruthy()
    expect(bloomFilter.test(`controller-a`)).toBeTruthy()
    expect(bloomFilter.test(`controller-b`)).toBeFalsy()
    expect(bloomFilter.test(`schema-undefined`)).toBeTruthy()
    expect(bloomFilter.test(`family-undefined`)).toBeTruthy()
    expect(bloomFilter.test(`tags-undefined`)).toBeFalsy()
  });

});
