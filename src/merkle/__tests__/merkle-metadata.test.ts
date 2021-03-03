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

  const makeMerkleTree = function() {
    return new MerkleTree<Candidate, TreeMetadata>(
      new IpfsMerge(ipfsService), new IpfsLeafCompare(), new BloomMetadata())
  }

  test('Single document minimal metadata', async () => {
    const merkleTree = makeMerkleTree()
    const candidates = [createCandidate({controllers: ["a"]})]
    await merkleTree.build(candidates)
    const metadata = merkleTree.getMetadata()
    expect(metadata.numEntries).toEqual(1)
    expect(metadata.bloomFilter.type).toEqual("jsnpm_bloomfilter.js")

    const bloomFilter = bloom.deserialize(metadata.bloomFilter.data)

    expect(bloomFilter.test(`docid-${candidates[0].document.id.baseID.toString()}`)).toBeTruthy()
    expect(bloomFilter.test(`controller-a`)).toBeTruthy()
    expect(bloomFilter.test(`controller-b`)).toBeFalsy()
  });

  test('Single document full metadata', async () => {
    const merkleTree = makeMerkleTree()
    const docMetadata = {
      controllers: ["a", "b"],
      schema: "schema",
      family: "family",
      tags: ["a", "b"] }
    const candidates = [createCandidate(docMetadata)]
    await merkleTree.build(candidates)
    const metadata = merkleTree.getMetadata()
    expect(metadata.numEntries).toEqual(1)
    expect(metadata.bloomFilter.type).toEqual("jsnpm_bloomfilter.js")

    const bloomFilter = bloom.deserialize(metadata.bloomFilter.data)

    expect(bloomFilter.test(`docid-${candidates[0].document.id.baseID.toString()}`)).toBeTruthy()
    expect(bloomFilter.test(`controller-a`)).toBeTruthy()
    expect(bloomFilter.test(`controller-b`)).toBeTruthy()
    expect(bloomFilter.test(`controller-c`)).toBeFalsy()
    expect(bloomFilter.test(`a`)).toBeFalsy()
    expect(bloomFilter.test(`schema-schema`)).toBeTruthy()
    expect(bloomFilter.test(`family-family`)).toBeTruthy()
    expect(bloomFilter.test(`tag-a`)).toBeTruthy()
    expect(bloomFilter.test(`tag-b`)).toBeTruthy()
    expect(bloomFilter.test(`tag-c`)).toBeFalsy()
  });

  test('Multiple documents full metadata', async () => {
    const merkleTree = makeMerkleTree()
    const docMetadata0 = {
      controllers: ["a", "b"],
      schema: "schema0",
      family: "family0",
      tags: ["a", "b"] }
    const docMetadata1 = {
      controllers: ["a"],
      schema: "schema1",
      family: "family0",
      tags: ["a", "b", "c", "d"] }
    const docMetadata2 = {
      controllers: ["b", "c"],
      schema: "schema2",
      family: "family1",
      tags: ["a", "c", "e"] }
    const candidates = [createCandidate(docMetadata0), createCandidate(docMetadata1), createCandidate(docMetadata2)]
    await merkleTree.build(candidates)
    const metadata = merkleTree.getMetadata()
    expect(metadata.numEntries).toEqual(3)
    expect(metadata.bloomFilter.type).toEqual("jsnpm_bloomfilter.js")

    const bloomFilter = bloom.deserialize(metadata.bloomFilter.data)

    expect(bloomFilter.test(`docid-${candidates[0].document.id.baseID.toString()}`)).toBeTruthy()
    expect(bloomFilter.test(`docid-${candidates[1].document.id.baseID.toString()}`)).toBeTruthy()
    expect(bloomFilter.test(`docid-${candidates[2].document.id.baseID.toString()}`)).toBeTruthy()
    expect(bloomFilter.test(`controller-a`)).toBeTruthy()
    expect(bloomFilter.test(`controller-b`)).toBeTruthy()
    expect(bloomFilter.test(`controller-c`)).toBeTruthy()
    expect(bloomFilter.test(`controller-d`)).toBeFalsy()
    expect(bloomFilter.test(`a`)).toBeFalsy()
    expect(bloomFilter.test(`schema-schema0`)).toBeTruthy()
    expect(bloomFilter.test(`schema-schema1`)).toBeTruthy()
    expect(bloomFilter.test(`schema-schema2`)).toBeTruthy()
    expect(bloomFilter.test(`schema-schema3`)).toBeFalsy()
    expect(bloomFilter.test(`family-family0`)).toBeTruthy()
    expect(bloomFilter.test(`family-family1`)).toBeTruthy()
    expect(bloomFilter.test(`family-family2`)).toBeFalsy()
    expect(bloomFilter.test(`tag-a`)).toBeTruthy()
    expect(bloomFilter.test(`tag-b`)).toBeTruthy()
    expect(bloomFilter.test(`tag-c`)).toBeTruthy()
    expect(bloomFilter.test(`tag-d`)).toBeTruthy()
    expect(bloomFilter.test(`tag-e`)).toBeTruthy()
    expect(bloomFilter.test(`tag-f`)).toBeFalsy()
  });

});
