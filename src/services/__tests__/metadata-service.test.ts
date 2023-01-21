import { jest, test, describe, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import type { Knex } from 'knex'
import { createDbConnection } from '../../db-connection.js'
import { MockIpfsService } from '../../__tests__/test-utils.js'
import { IpfsGenesisHeader, MetadataService } from '../metadata-service.js'
import { CommitID, StreamID } from '@ceramicnetwork/streamid'
import { randomBytes } from '@stablelib/random'
import { MetadataRepository } from '../../repositories/metadata-repository.js'
import cloneDeep from 'lodash.clonedeep'
import { ThrowDecoder } from '../../ancillary/throw-decoder.js'

const SCHEMA_COMMIT_ID = CommitID.fromString(
  'k1dpgaqe3i64kjqcp801r3sn7ysi5i0k7nxvs7j351s7kewfzr3l7mdxnj7szwo4kr9mn2qki5nnj0cv836ythy1t1gya9s25cn1nexst3jxi5o3h6qprfyju'
)
const HEADER_RECORD = {
  controllers: ['did:key:controller'],
  family: 'family',
  model: randomBytes(32),
  schema: SCHEMA_COMMIT_ID.toString(),
  tags: ['tag0', 'tag1'],
}
const GENESIS_FIELDS = { ...HEADER_RECORD, schema: SCHEMA_COMMIT_ID }

const ipfsService = new MockIpfsService()
let dbConnection: Knex
let metadataRepository: MetadataRepository
let metadataService: MetadataService

beforeAll(async () => {
  dbConnection = await createDbConnection()
  metadataRepository = new MetadataRepository(dbConnection)
  metadataService = new MetadataService(metadataRepository, ipfsService)
})

afterEach(async () => {
  ipfsService.reset()
  await metadataRepository.table().delete()
  jest.clearAllMocks()
})

afterAll(async () => {
  await dbConnection.destroy()
})

async function putGenesisHeader(payload: object): Promise<StreamID> {
  const cid = await ipfsService.storeRecord({
    header: payload,
  })
  return new StreamID(1, cid)
}

test('strip extra fields when decoding IPFS record', () => {
  const record = cloneDeep({ ...HEADER_RECORD, extra: 33 })
  expect(record.extra).toBeDefined() // Original record has `extra`
  const decoded = ThrowDecoder.decode(IpfsGenesisHeader, record)
  expect('extra' in decoded).toBeFalsy() // No `extra` after decoding
})

describe('retrieveFromGenesis', () => {
  test('get DAG-CBOR genesis from IPFS', async () => {
    const streamId = await putGenesisHeader(HEADER_RECORD)
    const retrieveRecordSpy = jest.spyOn(ipfsService, 'retrieveRecord')
    const genesisFields = await metadataService.retrieveFromGenesis(streamId)
    expect(retrieveRecordSpy).toBeCalledWith(streamId.cid, { signal: undefined })
    expect(genesisFields).toEqual(GENESIS_FIELDS)
    retrieveRecordSpy.mockRestore()
  })

  test('get DAG-JOSE genesis from IPFS', async () => {
    // Genesis CID is in DAG-JOSE
    const streamId = StreamID.fromString(
      'kjzl6cwe1jw146wg7fp48nuict3spcxna1h3p6zipzn4yl74d0m00jioeetw4p0'
    )
    const retrieveRecordSpy = jest.spyOn(ipfsService, 'retrieveRecord')
    // We expect that IpfsService#retrieveRecord is called once with CID and `path`.
    // Let's return the actual genesis as if IPFS traversed through `path`.
    retrieveRecordSpy.mockImplementation(async () => {
      return { header: HEADER_RECORD }
    })
    const genesisFields = await metadataService.retrieveFromGenesis(streamId)
    expect(retrieveRecordSpy).toBeCalledTimes(1)
    // If DAG-JOSE, then retrieve /link
    expect(retrieveRecordSpy).toBeCalledWith(streamId.cid, { path: '/link' })
    retrieveRecordSpy.mockRestore()
    // We are not really interested in `genesisFields` _here_, but let's keep it anyway.
    expect(genesisFields).toEqual(GENESIS_FIELDS)
  })

  describe('invalid genesis', () => {
    let header: any

    beforeEach(() => {
      header = cloneDeep(HEADER_RECORD)
    })

    test('no "controllers" field', async () => {
      delete header.controllers
      const streamId = await putGenesisHeader(header)
      await expect(metadataService.retrieveFromGenesis(streamId)).rejects.toThrow(
        /Validation error:.*\/controllers/
      )
    })

    test('empty controllers array', async () => {
      const streamId = await putGenesisHeader({
        ...header,
        controllers: [],
      })
      await expect(metadataService.retrieveFromGenesis(streamId)).rejects.toThrow(
        /Validation error:.*\/controllers/
      )
    })

    test('multiple controllers', async () => {
      const streamId = await putGenesisHeader({
        ...header,
        controllers: ['did:key:one', 'did:key:two'],
      })
      await expect(metadataService.retrieveFromGenesis(streamId)).rejects.toThrow(
        /Validation error:.*\/controllers/
      )
    })

    test('invalid controller', async () => {
      const streamId = await putGenesisHeader({
        ...header,
        controllers: ['some-garbage'],
      })
      await expect(metadataService.retrieveFromGenesis(streamId)).rejects.toThrow(
        /Validation error:.*\/controllers/
      )
    })

    test('family is not string', async () => {
      const streamId = await putGenesisHeader({
        ...header,
        family: 33,
      })
      await expect(metadataService.retrieveFromGenesis(streamId)).rejects.toThrow(
        /Validation error:.*\/family/
      )
    })

    test('model is not Uint8Array', async () => {
      const streamId = await putGenesisHeader({
        ...header,
        model: 'garbage',
      })
      await expect(metadataService.retrieveFromGenesis(streamId)).rejects.toThrow(
        /Validation error:.*\/model/
      )
    })

    test('schema is invalid', async () => {
      const streamId = await putGenesisHeader({
        ...header,
        schema: 'garbage',
      })
      await expect(metadataService.retrieveFromGenesis(streamId)).rejects.toThrow(
        /Validation error:.*\/schema/
      )
    })

    test('tags are not Array<string>', async () => {
      const streamId = await putGenesisHeader({
        ...header,
        tags: [33],
      })
      await expect(metadataService.retrieveFromGenesis(streamId)).rejects.toThrow(
        /Validation error:.*\/tags/
      )
    })
  })
})

describe('storeMetadata', () => {
  test('create metadata row', async () => {
    const streamId = await putGenesisHeader(HEADER_RECORD)
    const genesisFields = await metadataService.retrieveFromGenesis(streamId)
    const saveSpy = jest.spyOn(metadataRepository, 'save')
    await metadataService.storeMetadata(streamId, genesisFields)
    expect(saveSpy).toBeCalledTimes(1)
    expect(saveSpy).toBeCalledWith({
      streamId: streamId,
      metadata: GENESIS_FIELDS,
    })
  })
})

describe('fill', () => {
  let streamId: StreamID

  beforeEach(async () => {
    streamId = await putGenesisHeader(HEADER_RECORD)
  })

  test('store metadata from genesis commit', async () => {
    const retrieveSpy = jest.spyOn(metadataService, 'retrieveFromGenesis')
    const saveSpy = jest.spyOn(metadataService, 'storeMetadata')
    await metadataService.fill(streamId)
    expect(retrieveSpy).toBeCalledTimes(1)
    expect(retrieveSpy).toBeCalledWith(streamId, {})
    expect(saveSpy).toBeCalledTimes(1)
    expect(saveSpy).toBeCalledWith(streamId, GENESIS_FIELDS)
  })

  describe('if an entry is already in the database', () => {
    test('do not retrieve genesis', async () => {
      const retrieveSpy = jest.spyOn(metadataService, 'retrieveFromGenesis')
      const saveSpy = jest.spyOn(metadataService, 'storeMetadata')
      await metadataService.fill(streamId)
      expect(retrieveSpy).toBeCalledTimes(1) // Retrieve from IPFS
      expect(saveSpy).toBeCalledTimes(1) // Store to the database
      retrieveSpy.mockClear()
      saveSpy.mockClear()
      await metadataService.fill(streamId)
      expect(retrieveSpy).toBeCalledTimes(0) // Do not retrieve from IPFS
      expect(saveSpy).toBeCalledTimes(0) // Do not store to the database.
    })

    // TODO CDB-2170 Do the test when approaching garbage collection
    // test('touch the entry', async () => {
    //   const now0 = new Date()
    //   await metadataService.fill(streamId)
    //   const retrieved0 = await metadataRepository.retrieve(streamId)
    //   expect(retrieved0.usedAt.valueOf()).toBeCloseTo(now0.valueOf(), -2)
    //   // Manually update `usedAt` to some time ago
    //   const someTimeAgo = new Date()
    //   someTimeAgo.setHours(someTimeAgo.getHours() - 15) // For example, 15 hours ago
    //   await metadataRepository.touch(streamId, someTimeAgo)
    //   const retrieved1 = await metadataRepository.retrieve(streamId)
    //   expect(retrieved1.usedAt).toEqual(someTimeAgo)
    //   // `MetadataService#fill` should update `usedAt` to _now_
    //   const now1 = new Date()
    //   await metadataService.fill(streamId)
    //   const retrieved2 = await metadataRepository.retrieve(streamId)
    //   expect(retrieved2.usedAt.valueOf()).toBeCloseTo(now1.valueOf(), -2)
    // })
  })
})
