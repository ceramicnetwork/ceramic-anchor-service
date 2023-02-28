import { jest, describe, expect, beforeEach, test } from '@jest/globals'
import { logger } from '../../logger/index.js'
import { MockIpfsService, randomStreamID } from '../../__tests__/test-utils.js'
import { BloomMetadata } from '../merkle-objects.js'
import { BloomFilter } from '@ceramicnetwork/wasm-bloom-filter'
import { expectPresent } from '../../__tests__/expect-present.util.js'
import {
  IpfsLeafCompare,
  IpfsMerge,
  MerkleTreeFactory,
  type CIDHolder,
  type ICandidate,
  type MerkleTree,
  type TreeMetadata,
} from '@ceramicnetwork/anchor-utils'

const TYPE_REGEX =
  /^jsnpm_@ceramicnetwork\/wasm-bloom-filter-v((([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?)(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?)$/
const isTypeString = (str: string) => Boolean(str.match(TYPE_REGEX))

describe('Bloom filter', () => {
  jest.setTimeout(10000)
  const ipfsService = new MockIpfsService()

  beforeEach(async () => {
    ipfsService.reset()
  })

  function createCandidate(metadata: any): ICandidate {
    const streamID = randomStreamID()
    return {
      cid: streamID.cid,
      streamId: streamID,
      metadata,
    }
  }

  function buildMerkleTree(
    leaves: Array<ICandidate>
  ): Promise<MerkleTree<CIDHolder, ICandidate, TreeMetadata>> {
    const factory = new MerkleTreeFactory<CIDHolder, ICandidate, TreeMetadata>(
      new IpfsMerge(ipfsService, logger),
      new IpfsLeafCompare(logger),
      new BloomMetadata()
    )
    return factory.build(leaves)
  }

  test('Single stream minimal metadata', async () => {
    const candidate = createCandidate({ controllers: ['a'] })
    const storeRecordSpy = jest.spyOn(ipfsService, 'storeRecord')
    const merkleTree = await buildMerkleTree([candidate])
    const metadata = merkleTree.metadata
    expectPresent(metadata)
    expect(metadata.numEntries).toEqual(1)
    expect(metadata.streamIds).toHaveLength(1)
    expect(metadata.streamIds).toEqual([candidate.streamId.toString()])
    expect(isTypeString(metadata.bloomFilter.type)).toEqual(true)
    expect(storeRecordSpy).toHaveBeenCalledWith(metadata)

    const bloomFilter = BloomFilter.fromString(metadata.bloomFilter.data)
    expect(bloomFilter.contains(`streamid-${candidate.streamId.toString()}`)).toBeTruthy()
    expect(bloomFilter.contains(`controller-a`)).toBeTruthy()
    expect(bloomFilter.contains(`controller-b`)).toBeFalsy()
  })

  test('Single stream with model', async () => {
    const model = randomStreamID()
    const streamMetadata = {
      controllers: ['a'],
      model: model,
    }
    const candidate = createCandidate(streamMetadata)
    const merkleTree = await buildMerkleTree([candidate])
    const metadata = merkleTree.metadata
    expectPresent(metadata)
    expect(metadata.numEntries).toEqual(1)
    expect(metadata.streamIds).toHaveLength(1)
    expect(metadata.streamIds).toEqual([candidate.streamId.toString()])
    expect(isTypeString(metadata.bloomFilter.type)).toEqual(true)

    const bloomFilter = BloomFilter.fromString(metadata.bloomFilter.data)
    expect(bloomFilter.contains(`streamid-${candidate.streamId.toString()}`)).toBeTruthy()
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
    const candidates: [ICandidate, ICandidate, ICandidate] = [
      createCandidate(streamMetadata0),
      createCandidate(streamMetadata1),
      createCandidate(streamMetadata2),
    ]
    const merkleTree = await buildMerkleTree(candidates)
    const metadata = merkleTree.metadata
    expectPresent(metadata)
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
    expect(bloomFilter.contains(`model-${candidates[0].metadata.model}`)).toBeTruthy()
    expect(bloomFilter.contains(`model-${candidates[1].metadata.model}`)).toBeTruthy()
    expect(bloomFilter.contains(`model-${candidates[2].metadata.model}`)).toBeTruthy()
    expect(bloomFilter.contains(`model-model3`)).toBeFalsy()
  })
})
