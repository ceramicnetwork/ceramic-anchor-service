import type { Knex } from 'knex'
import { afterAll, beforeAll, beforeEach, test, expect, describe } from '@jest/globals'
import { createDbConnection } from '../../db-connection.js'
import { MetadataRepository } from '../metadata-repository.js'
import type { FreshMetadata } from '../../models/metadata.js'
import { isClose, randomStreamID } from '../../__tests__/test-utils.js'
import { asDIDString } from '@ceramicnetwork/codecs'
import { expectPresent } from '../../__tests__/expect-present.util.js'

let dbConnection: Knex
let repository: MetadataRepository

const FRESH_METADATA = createFreshMetadata()

function createFreshMetadata(): FreshMetadata {
  return {
    streamId: randomStreamID(),
    metadata: {
      controllers: [asDIDString('did:key:controller')],
      model: randomStreamID(),
      tags: ['hello'],
    },
  }
}

beforeAll(async () => {
  dbConnection = await createDbConnection()
  repository = new MetadataRepository(dbConnection)
})

beforeEach(async () => {
  await repository.table.delete()
})

afterAll(async () => {
  await dbConnection.destroy()
})

describe('save', () => {
  test('save', async () => {
    await expect(repository.countAll()).resolves.toEqual(0)
    await repository.save(FRESH_METADATA)
    await expect(repository.countAll()).resolves.toEqual(1)
  })

  test('ignore when conflict', async () => {
    await expect(repository.countAll()).resolves.toEqual(0)
    await repository.save(FRESH_METADATA) // Insert an entry
    await expect(repository.countAll()).resolves.toEqual(1)
    await repository.save(FRESH_METADATA) // We already have an entry for streamId, so do not really insert
    await expect(repository.countAll()).resolves.toEqual(1) // Still single entry
  })
})

test('retrieve', async () => {
  await expect(repository.retrieve(FRESH_METADATA.streamId)).resolves.toBeUndefined()
  const now = Date.now()
  await repository.save(FRESH_METADATA)
  const retrieved1 = await repository.retrieve(FRESH_METADATA.streamId)
  expectPresent(retrieved1)
  expect(retrieved1.streamId).toEqual(FRESH_METADATA.streamId)
  expect(retrieved1.metadata).toEqual(FRESH_METADATA.metadata)
  expect(isClose(retrieved1.createdAt.getTime(), now, 0.05)).toBeTruthy()
  expect(isClose(retrieved1.updatedAt.getTime(), now, 0.06)).toBeTruthy()
  expect(isClose(retrieved1.usedAt.getTime(), now, 0.05)).toBeTruthy()
})

test('isPresent', async () => {
  const streamId = FRESH_METADATA.streamId
  await expect(repository.retrieve(streamId)).resolves.toBeUndefined()
  await expect(repository.isPresent(streamId)).resolves.toBeFalsy()
  await repository.save(FRESH_METADATA)
  await expect(repository.retrieve(streamId)).resolves.toBeTruthy()
  await expect(repository.isPresent(streamId)).resolves.toBeTruthy()
})

test('touch', async () => {
  const streamId = FRESH_METADATA.streamId
  // `usedAt` set to _now_ when created
  await repository.save(FRESH_METADATA)
  const now0 = new Date()
  const retrieved0 = await repository.retrieve(streamId)
  expectPresent(retrieved0)
  expect(retrieved0.usedAt.valueOf()).toBeCloseTo(now0.valueOf(), -2)

  // Update `usedAt` to 15 hours from _now_
  const whenTouched = new Date()
  whenTouched.setHours(whenTouched.getHours() + 15) // Move 15 hours forward, for example
  await repository.touch(streamId, whenTouched)
  const retrieved1 = await repository.retrieve(streamId)
  expectPresent(retrieved1)
  expect(retrieved1.usedAt).toEqual(whenTouched)

  // Use _now_ as default value
  const now1 = new Date()
  await repository.touch(streamId)
  const retrieved2 = await repository.retrieve(streamId)
  expectPresent(retrieved2)
  expect(retrieved2.usedAt.valueOf()).toBeCloseTo(now1.valueOf(), -2)
})

test('batchRetrieve', async () => {
  const metadata1 = createFreshMetadata()
  const metadata2 = createFreshMetadata()

  await repository.save(metadata1)
  await repository.save(metadata2)
  const retrieved = await repository.batchRetrieve([
    metadata1.streamId,
    metadata2.streamId,
    FRESH_METADATA.streamId,
  ])
  expect(retrieved.length).toEqual(2)

  const retrieved1 = retrieved.find((m) => m.streamId.toString() === metadata1.streamId.toString())
  const retrieved2 = retrieved.find((m) => m.streamId.toString() === metadata2.streamId.toString())
  const retreived3 = retrieved.find(
    (m) => m.streamId.toString() === FRESH_METADATA.streamId.toString()
  )

  expectPresent(retrieved1)
  expect(retrieved1.streamId).toEqual(metadata1.streamId)
  expect(retrieved1.metadata).toEqual(metadata1.metadata)

  expectPresent(retrieved2)
  expect(retrieved2.streamId).toEqual(metadata2.streamId)
  expect(retrieved2.metadata).toEqual(metadata2.metadata)

  expect(retreived3).toBeUndefined()
})
