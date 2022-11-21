import { jest } from '@jest/globals'
import { MockIpfsService, randomCID } from '../../__tests__/test-utils.js'
import { MerkleTree } from '../merkle-tree.js'
import { type Node, TreeMetadata } from '../merkle.js'
import {
  BloomMetadata,
  Candidate,
  CIDHolder,
  IpfsLeafCompare,
  IpfsMerge,
} from '../merkle-objects.js'
import { StreamID } from '@ceramicnetwork/streamid'
import { BloomFilter } from '@ceramicnetwork/wasm-bloom-filter'
import { Request } from '../../models/request.js'
import { AnchorStatus } from '@ceramicnetwork/common'

const TYPE_REGEX =
  /^jsnpm_@ceramicnetwork\/wasm-bloom-filter-v((([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?)(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?)$/
const isTypeString = (str: string) => Boolean(str.match(TYPE_REGEX))

describe('Bloom filter', () => {
  jest.setTimeout(10000)
  const ipfsService = new MockIpfsService()

  beforeEach(async () => {
    ipfsService.reset()
  })

  const createCandidate = async function (metadata: any): Promise<Candidate> {
    const cid = randomCID()
    const stream = {
      id: new StreamID('tile', cid),
      tip: cid,
      metadata,
      state: { anchorStatus: AnchorStatus.PENDING, log: [{ cid }], metadata },
    }
    const candidate = new Candidate(stream.id, [new Request()])
    candidate.setTipToAnchor(stream as any)
    return candidate
  }

  const makeMerkleTree = function () {
    return new MerkleTree<CIDHolder, Candidate, TreeMetadata>(
      new IpfsMerge(ipfsService),
      new IpfsLeafCompare(),
      new BloomMetadata()
    )
  }

  test('Single stream minimal metadata', async () => {
    const merkleTree = makeMerkleTree()
    const candidates = [await createCandidate({ controllers: ['a'] })]
    await merkleTree.build(candidates)
    const metadata = merkleTree.getMetadata()
    expect(metadata.numEntries).toEqual(1)
    expect(metadata.streamIds).toHaveLength(1)
    expect(metadata.streamIds).toEqual([candidates[0].streamId.toString()])
    expect(isTypeString(metadata.bloomFilter.type)).toEqual(true)

    const bloomFilter = BloomFilter.fromString(metadata.bloomFilter.data)
    expect(bloomFilter.contains(`streamid-${candidates[0].streamId.toString()}`)).toBeTruthy()
    expect(bloomFilter.contains(`controller-a`)).toBeTruthy()
    expect(bloomFilter.contains(`controller-b`)).toBeFalsy()
  })

  test('Single stream with model', async () => {
    const merkleTree = makeMerkleTree()
    const streamMetadata = {
      controllers: ['a'],
      model: 'model',
    }
    const candidates = [await createCandidate(streamMetadata)]
    await merkleTree.build(candidates)
    const metadata = merkleTree.getMetadata()
    expect(metadata.numEntries).toEqual(1)
    expect(metadata.streamIds).toHaveLength(1)
    expect(metadata.streamIds).toEqual([candidates[0].streamId.toString()])
    expect(isTypeString(metadata.bloomFilter.type)).toEqual(true)

    const bloomFilter = BloomFilter.fromString(metadata.bloomFilter.data)
    expect(bloomFilter.contains(`streamid-${candidates[0].streamId.toString()}`)).toBeTruthy()
    expect(bloomFilter.contains(`controller-a`)).toBeTruthy()
    expect(bloomFilter.contains(`controller-b`)).toBeFalsy()
    expect(bloomFilter.contains(`a`)).toBeFalsy()
    expect(bloomFilter.contains(`model-model`)).toBeTruthy()
  })

  test('Multiple streams with model', async () => {
    const merkleTree = makeMerkleTree()
    const streamMetadata0 = {
      controllers: ['a'],
      model: 'model0',
      family: 'family0',
      tags: ['a', 'b'],
    }
    const streamMetadata1 = {
      controllers: ['a'],
      model: 'model1',
    }
    const streamMetadata2 = {
      controllers: ['b'],
      model: 'model2',
    }
    const candidates = await Promise.all([
      createCandidate(streamMetadata0),
      createCandidate(streamMetadata1),
      createCandidate(streamMetadata2),
    ])
    await merkleTree.build(candidates)
    const metadata = merkleTree.getMetadata()
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
    expect(bloomFilter.contains(`model-model0`)).toBeTruthy()
    expect(bloomFilter.contains(`model-model1`)).toBeTruthy()
    expect(bloomFilter.contains(`model-model2`)).toBeTruthy()
    expect(bloomFilter.contains(`model-model3`)).toBeFalsy()
  })
})

describe('IpfsLeafCompare sorting', () => {
  const leaves = new IpfsLeafCompare()

  const mockNode = (streamId: string, metadata: any): Node<Candidate> => {
    return { data: { streamId, metadata } } as unknown as Node<Candidate>
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
