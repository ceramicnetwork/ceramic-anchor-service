import { CidGenerator, MockIpfsService } from '../../test-utils';
import { MerkleTree } from '../merkle-tree';
import { TreeMetadata } from '../merkle';
import { BloomMetadata, Candidate, IpfsLeafCompare, IpfsMerge } from '../merkle-objects';
import DocID from '@ceramicnetwork/docid';
import { BloomFilter } from 'bloom-filters';

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
    expect(metadata.bloomFilter.type).toEqual("jsnpm_bloom-filters")

    // @ts-ignore
    const bloomFilter = BloomFilter.fromJSON(metadata.bloomFilter.data)

    expect(bloomFilter.has(`docid-${candidates[0].document.id.baseID.toString()}`)).toBeTruthy()
    expect(bloomFilter.has(`controller-a`)).toBeTruthy()
    expect(bloomFilter.has(`controller-b`)).toBeFalsy()
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
    expect(metadata.bloomFilter.type).toEqual("jsnpm_bloom-filters")

    // @ts-ignore
    const bloomFilter = BloomFilter.fromJSON(metadata.bloomFilter.data)

    expect(bloomFilter.has(`docid-${candidates[0].document.id.baseID.toString()}`)).toBeTruthy()
    expect(bloomFilter.has(`controller-a`)).toBeTruthy()
    expect(bloomFilter.has(`controller-b`)).toBeTruthy()
    expect(bloomFilter.has(`controller-c`)).toBeFalsy()
    expect(bloomFilter.has(`a`)).toBeFalsy()
    expect(bloomFilter.has(`schema-schema`)).toBeTruthy()
    expect(bloomFilter.has(`family-family`)).toBeTruthy()
    expect(bloomFilter.has(`tag-a`)).toBeTruthy()
    expect(bloomFilter.has(`tag-b`)).toBeTruthy()
    expect(bloomFilter.has(`tag-c`)).toBeFalsy()
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
    expect(metadata.bloomFilter.type).toEqual("jsnpm_bloom-filters")

    // @ts-ignore
    const bloomFilter = BloomFilter.fromJSON(metadata.bloomFilter.data)

    expect(bloomFilter.has(`docid-${candidates[0].document.id.baseID.toString()}`)).toBeTruthy()
    expect(bloomFilter.has(`docid-${candidates[1].document.id.baseID.toString()}`)).toBeTruthy()
    expect(bloomFilter.has(`docid-${candidates[2].document.id.baseID.toString()}`)).toBeTruthy()
    expect(bloomFilter.has(`controller-a`)).toBeTruthy()
    expect(bloomFilter.has(`controller-b`)).toBeTruthy()
    expect(bloomFilter.has(`controller-c`)).toBeTruthy()
    expect(bloomFilter.has(`controller-d`)).toBeFalsy()
    expect(bloomFilter.has(`a`)).toBeFalsy()
    expect(bloomFilter.has(`schema-schema0`)).toBeTruthy()
    expect(bloomFilter.has(`schema-schema1`)).toBeTruthy()
    expect(bloomFilter.has(`schema-schema2`)).toBeTruthy()
    expect(bloomFilter.has(`schema-schema3`)).toBeFalsy()
    expect(bloomFilter.has(`family-family0`)).toBeTruthy()
    expect(bloomFilter.has(`family-family1`)).toBeTruthy()
    expect(bloomFilter.has(`family-family2`)).toBeFalsy()
    expect(bloomFilter.has(`tag-a`)).toBeTruthy()
    expect(bloomFilter.has(`tag-b`)).toBeTruthy()
    expect(bloomFilter.has(`tag-c`)).toBeTruthy()
    expect(bloomFilter.has(`tag-d`)).toBeTruthy()
    expect(bloomFilter.has(`tag-e`)).toBeTruthy()
    expect(bloomFilter.has(`tag-f`)).toBeFalsy()
  });

});
