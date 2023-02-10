import { jest, describe, expect, beforeEach } from '@jest/globals'
import { MockIpfsService, randomStreamID } from '../../__tests__/test-utils.js'
import type { MerkleTree } from '../merkle-tree.js'
import { type Node, TreeMetadata } from '../merkle.js'
import {
  BloomMetadata,
  Candidate,
  CIDHolder,
  IpfsLeafCompare,
  IpfsMerge,
} from '../merkle-objects.js'
import { BloomFilter } from '@ceramicnetwork/wasm-bloom-filter'
import { Request } from '../../models/request.js'
import { AnchorStatus } from '@ceramicnetwork/common'
import { MerkleTreeFactory } from '../merkle-tree-factory.js'

const TYPE_REGEX =
  /^jsnpm_@ceramicnetwork\/wasm-bloom-filter-v((([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?)(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?)$/
const isTypeString = (str: string) => Boolean(str.match(TYPE_REGEX))

describe('Bloom filter', () => {
  jest.setTimeout(10000)
  const ipfsService = new MockIpfsService()

  beforeEach(async () => {
    ipfsService.reset()
  })

  function createCandidate(metadata: any): Candidate {
    const streamID = randomStreamID()
    const stream = {
      id: streamID,
      tip: streamID.cid,
      metadata,
      state: { anchorStatus: AnchorStatus.PENDING, log: [{ cid: streamID.cid }], metadata },
    }
    return new Candidate(stream.id, new Request({ cid: streamID.cid.toString() }), metadata)
  }

  function buildMerkleTree(
    leaves: Array<Candidate>
  ): Promise<MerkleTree<CIDHolder, Candidate, TreeMetadata>> {
    const factory = new MerkleTreeFactory<CIDHolder, Candidate, TreeMetadata>(
      new IpfsMerge(ipfsService),
      new IpfsLeafCompare(),
      new BloomMetadata()
    )
    return factory.build(leaves)
  }

  test('Single stream minimal metadata', async () => {
    const candidates = [createCandidate({ controllers: ['a'] })]
    const merkleTree = await buildMerkleTree(candidates)
    const metadata = merkleTree.metadata
    expect(metadata.numEntries).toEqual(1)
    expect(metadata.streamIds).toHaveLength(1)
    expect(metadata.streamIds).toEqual([candidates[0].streamId.toString()])
    expect(isTypeString(metadata.bloomFilter.type)).toEqual(true)
    expect(ipfsService.storeRecord).toHaveBeenCalledWith(metadata)

    const bloomFilter = BloomFilter.fromString(metadata.bloomFilter.data)
    expect(bloomFilter.contains(`streamid-${candidates[0].streamId.toString()}`)).toBeTruthy()
    expect(bloomFilter.contains(`controller-a`)).toBeTruthy()
    expect(bloomFilter.contains(`controller-b`)).toBeFalsy()
  })

  test('Single stream with model', async () => {
    const model = randomStreamID()
    const streamMetadata = {
      controllers: ['a'],
      model: model.bytes,
    }
    const candidates = [createCandidate(streamMetadata)]
    const merkleTree = await buildMerkleTree(candidates)
    const metadata = merkleTree.metadata
    expect(metadata.numEntries).toEqual(1)
    expect(metadata.streamIds).toHaveLength(1)
    expect(metadata.streamIds).toEqual([candidates[0].streamId.toString()])
    expect(isTypeString(metadata.bloomFilter.type)).toEqual(true)

    const bloomFilter = BloomFilter.fromString(metadata.bloomFilter.data)
    expect(bloomFilter.contains(`streamid-${candidates[0].streamId.toString()}`)).toBeTruthy()
    expect(bloomFilter.contains(`controller-a`)).toBeTruthy()
    expect(bloomFilter.contains(`controller-b`)).toBeFalsy()
    expect(bloomFilter.contains(`a`)).toBeFalsy()
    expect(bloomFilter.contains(`model-${model.toString()}`)).toBeTruthy()
  })

  test('Multiple streams with model', async () => {
    const streamMetadata0 = {
      controllers: ['a'],
      model: randomStreamID().bytes,
      family: 'family0',
      tags: ['a', 'b'],
    }
    const streamMetadata1 = {
      controllers: ['a'],
      model: randomStreamID().bytes,
    }
    const streamMetadata2 = {
      controllers: ['b'],
      model: randomStreamID().bytes,
    }
    const candidates = [
      createCandidate(streamMetadata0),
      createCandidate(streamMetadata1),
      createCandidate(streamMetadata2),
    ]
    const merkleTree = await buildMerkleTree(candidates)
    const metadata = merkleTree.metadata
    expect(metadata.numEntries).toEqual(3)
    expect(metadata.streamIds).toHaveLength(3)
    expect(metadata.streamIds).toEqual(
      expect.arrayContaining(candidates.map((candidate) => candidate.streamId.toString()))
    )
    expect(isTypeString(metadata.bloomFilter.type)).toEqual(true)

    const bloomFilter = BloomFilter.fromString(metadata.bloomFilter.data)
    expect(bloomFilter.contains(`streamid-${candidates[0].streamId.toString()}`)).toBeTruthy()
    expect(bloomFilter.contains(`streamid-${candidates[1].streamId.toString()}`)).toBeTruthy()
    expect(bloomFilter.contains(`streamid-${candidates[2].streamId.toString()}`)).toBeTruthy()
    expect(bloomFilter.contains(`controller-a`)).toBeTruthy()
    expect(bloomFilter.contains(`controller-b`)).toBeTruthy()
    expect(bloomFilter.contains(`controller-c`)).toBeFalsy()
    expect(bloomFilter.contains(`a`)).toBeFalsy()
    expect(bloomFilter.contains(`model-${candidates[0].model.toString()}`)).toBeTruthy()
    expect(bloomFilter.contains(`model-${candidates[1].model.toString()}`)).toBeTruthy()
    expect(bloomFilter.contains(`model-${candidates[2].model.toString()}`)).toBeTruthy()
    expect(bloomFilter.contains(`model-model3`)).toBeFalsy()
  })
})

describe('IpfsLeafCompare sorting', () => {
  const leaves = new IpfsLeafCompare()

  const mockNode = (streamId: string, metadata: any): Node<Candidate> => {
    return { data: { streamId, metadata, model: metadata.model } } as unknown as Node<Candidate>
  }

  const node0 = mockNode('id0', { controllers: ['a'] })
  const node1 = mockNode('id1', {
    controllers: ['b'],
    model: 'model1',
  })
  const node2 = mockNode('id2', {
    controllers: ['a'],
    model: 'model2',
  })
  const node3 = mockNode('id3', {
    controllers: ['b'],
    model: 'model2',
  })
  const node4 = mockNode('id4', {
    controllers: ['b'],
    model: 'model2',
  })

  test('model ordering - single model', () => {
    // Pick node1 that contains a model
    expect(leaves.compare(node0, node1)).toBe(1)
  })

  test('model ordering - two models', () => {
    // Pick node1, sorted by model name
    expect(leaves.compare(node1, node2)).toBe(-1)
  })

  test('controller ordering', () => {
    // Same model, compare by controller, pick node2 sorted by controller name
    expect(leaves.compare(node2, node3)).toBe(-1)
  })

  test('streamID ordering', () => {
    // Same model and controller, pick node3 sorted by stream ID
    expect(leaves.compare(node3, node4)).toBe(-1)
  })
})
