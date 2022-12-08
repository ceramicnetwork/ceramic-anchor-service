import { jest, test, describe, expect, beforeAll, afterAll } from '@jest/globals'
import type { Knex } from 'knex'
import { createDbConnection } from '../../db-connection.js'
import { MockIpfsService } from '../../__tests__/test-utils.js'
import { MetadataService } from '../metadata-service.js'
import { CommitID, StreamID } from '@ceramicnetwork/streamid'
import { randomBytes } from '@stablelib/random'
import { MetadataRepository } from '../../repositories/metadata-repository.js'
import cloneDeep from 'lodash.clonedeep'

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

afterAll(async () => {
  await dbConnection.destroy()
})

async function putGenesisHeader(payload: object): Promise<StreamID> {
  const cid = await ipfsService.storeRecord({
    header: payload,
  })
  return new StreamID(1, cid)
}

describe('retrieveFromGenesis', () => {
  test('get genesis from IPFS', async () => {
    const streamId = await putGenesisHeader(HEADER_RECORD)
    const retrieveRecordSpy = jest.spyOn(ipfsService, 'retrieveRecord')
    const genesisFields = await metadataService.retrieveFromGenesis(streamId)
    expect(retrieveRecordSpy).toBeCalledWith(streamId.cid)
    expect(genesisFields.controllers).toEqual(GENESIS_FIELDS.controllers)
    expect(genesisFields.family).toEqual(GENESIS_FIELDS.family)
    expect(genesisFields.model).toEqual(GENESIS_FIELDS.model)
    expect(genesisFields.schema).toEqual(GENESIS_FIELDS.schema)
    expect(genesisFields.tags).toEqual(GENESIS_FIELDS.tags)
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
  test('store metadata from genesis commit', async () => {
    const streamId = await putGenesisHeader(HEADER_RECORD)
    const retrieveSpy = jest.spyOn(metadataService, 'retrieveFromGenesis')
    const saveSpy = jest.spyOn(metadataService, 'storeMetadata')
    await metadataService.fill(streamId)
    expect(retrieveSpy).toBeCalledTimes(1)
    expect(retrieveSpy).toBeCalledWith(streamId)
    expect(saveSpy).toBeCalledTimes(1)
    expect(saveSpy).toBeCalledWith(streamId, GENESIS_FIELDS)
  })
})
