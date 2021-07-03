import { CidGenerator, MockIpfsService } from '../../test-utils';
import { MerkleTree } from '../merkle-tree';
import { TreeMetadata } from '../merkle';
import { BloomMetadata, Candidate, CIDHolder, IpfsLeafCompare, IpfsMerge } from '../merkle-objects';
import { StreamID } from '@ceramicnetwork/streamid';
import { BloomFilter } from 'bloom-filters';
import { Request } from "../../models/request";
import { AnchorStatus } from '@ceramicnetwork/common';

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
    const stream = {
      id: new StreamID('tile', cid),
      tip: cid,
      metadata,
      state: { anchorStatus: AnchorStatus.PENDING, log: [{ cid }]} }
    const candidate = new Candidate(stream.id, [new Request()])
    candidate.setTipToAnchor(stream as any)
    return candidate
  }

  const makeMerkleTree = function() {
    return new MerkleTree<CIDHolder, Candidate, TreeMetadata>(
      new IpfsMerge(ipfsService), new IpfsLeafCompare(), new BloomMetadata())
  }

  test('Single stream minimal metadata', async () => {
    const merkleTree = makeMerkleTree()
    const candidates = [createCandidate({controllers: ["a"]})]
    await merkleTree.build(candidates)
    const metadata = merkleTree.getMetadata()
    expect(metadata.numEntries).toEqual(1)
    expect(metadata.bloomFilter.type).toEqual("jsnpm_bloom-filters")

    // @ts-ignore
    const bloomFilter = BloomFilter.fromJSON(metadata.bloomFilter.data)

    expect(bloomFilter.has(`streamid-${candidates[0].streamId.toString()}`)).toBeTruthy()
    expect(bloomFilter.has(`controller-a`)).toBeTruthy()
    expect(bloomFilter.has(`controller-b`)).toBeFalsy()
  });

  test('Single stream full metadata', async () => {
    const merkleTree = makeMerkleTree()
    const streamMetadata = {
      controllers: ["a", "b"],
      schema: "schema",
      family: "family",
      tags: ["a", "b"] }
    const candidates = [createCandidate(streamMetadata)]
    await merkleTree.build(candidates)
    const metadata = merkleTree.getMetadata()
    expect(metadata.numEntries).toEqual(1)
    expect(metadata.bloomFilter.type).toEqual("jsnpm_bloom-filters")

    // @ts-ignore
    const bloomFilter = BloomFilter.fromJSON(metadata.bloomFilter.data)

    expect(bloomFilter.has(`streamid-${candidates[0].streamId.toString()}`)).toBeTruthy()
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

  test('Multiple streams full metadata', async () => {
    const merkleTree = makeMerkleTree()
    const streamMetadata0 = {
      controllers: ["a", "b"],
      schema: "schema0",
      family: "family0",
      tags: ["a", "b"] }
    const streamMetadata1 = {
      controllers: ["a"],
      schema: "schema1",
      family: "family0",
      tags: ["a", "b", "c", "d"] }
    const streamMetadata2 = {
      controllers: ["b", "c"],
      schema: "schema2",
      family: "family1",
      tags: ["a", "c", "e"] }
    const candidates = [createCandidate(streamMetadata0), createCandidate(streamMetadata1), createCandidate(streamMetadata2)]
    await merkleTree.build(candidates)
    const metadata = merkleTree.getMetadata()
    expect(metadata.numEntries).toEqual(3)
    expect(metadata.bloomFilter.type).toEqual("jsnpm_bloom-filters")

    // @ts-ignore
    const bloomFilter = BloomFilter.fromJSON(metadata.bloomFilter.data)

    expect(bloomFilter.has(`streamid-${candidates[0].streamId.toString()}`)).toBeTruthy()
    expect(bloomFilter.has(`streamid-${candidates[1].streamId.toString()}`)).toBeTruthy()
    expect(bloomFilter.has(`streamid-${candidates[2].streamId.toString()}`)).toBeTruthy()
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
