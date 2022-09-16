import { jest } from '@jest/globals'
import { MockIpfsService, randomCID } from '../../__tests__/test-utils.js'
import { MerkleTree } from '../merkle-tree.js'
import { TreeMetadata } from '../merkle.js'
import {
  BloomMetadata,
  Candidate,
  CIDHolder,
  IpfsLeafCompare,
  IpfsMerge,
} from '../merkle-objects.js'
import { StreamID } from '@ceramicnetwork/streamid'
import { BloomFilter } from 'bloom-filters'
import { Request } from '../../models/request.js'
import { AnchorStatus } from '@ceramicnetwork/common'

const TYPE_REGEX =
  /^jsnpm_bloom-filters-v((([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?)(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?)$/
const isTypeString = (str: string) => Boolean(str.match(TYPE_REGEX))

describe('Bloom filter', () => {
  jest.setTimeout(10000)
  const ipfsService = new MockIpfsService()

  beforeEach(async () => {
    ipfsService.reset()
  })

  const createCandidate = async function (metadata: any): Promise<Candidate> {
    const cid = await randomCID()
    const stream = {
      id: new StreamID('tile', cid),
      tip: cid,
      metadata,
      state: { anchorStatus: AnchorStatus.PENDING, log: [{ cid }] },
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

    // @ts-ignore
    const bloomFilter = BloomFilter.fromJSON(metadata.bloomFilter.data)

    expect(bloomFilter.has(`streamid-${candidates[0].streamId.toString()}`)).toBeTruthy()
    expect(bloomFilter.has(`controller-a`)).toBeTruthy()
    expect(bloomFilter.has(`controller-b`)).toBeFalsy()
  })

  test('Single stream full metadata', async () => {
    const merkleTree = makeMerkleTree()
    const streamMetadata = {
      controllers: ['a', 'b'],
      schema: 'schema',
      family: 'family',
      tags: ['a', 'b'],
    }
    const candidates = [await createCandidate(streamMetadata)]
    await merkleTree.build(candidates)
    const metadata = merkleTree.getMetadata()
    expect(metadata.numEntries).toEqual(1)
    expect(metadata.streamIds).toHaveLength(1)
    expect(metadata.streamIds).toEqual([candidates[0].streamId.toString()])
    expect(isTypeString(metadata.bloomFilter.type)).toEqual(true)

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
  })

  test('Multiple streams full metadata', async () => {
    const merkleTree = makeMerkleTree()
    const streamMetadata0 = {
      controllers: ['a', 'b'],
      schema: 'schema0',
      family: 'family0',
      tags: ['a', 'b'],
    }
    const streamMetadata1 = {
      controllers: ['a'],
      schema: 'schema1',
      family: 'family0',
      tags: ['a', 'b', 'c', 'd'],
    }
    const streamMetadata2 = {
      controllers: ['b', 'c'],
      schema: 'schema2',
      family: 'family1',
      tags: ['a', 'c', 'e'],
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
  })
})
