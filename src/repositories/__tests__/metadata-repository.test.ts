import type { Knex } from 'knex'
import { afterAll, beforeAll, test, expect } from '@jest/globals'
import { createDbConnection } from '../../db-connection.js'
import { MetadataRepository } from '../metadata-repository.js'
import type { FreshMetadata } from '../../models/metadata.js'
import { randomStreamID } from '../../__tests__/test-utils.js'

let dbConnection: Knex

beforeAll(async () => {
  dbConnection = await createDbConnection()
})

afterAll(async () => {
  await dbConnection.destroy()
})

test('save', async () => {
  const repository = new MetadataRepository(dbConnection)
  const input: FreshMetadata = {
    streamId: randomStreamID(),
    metadata: {
      controllers: ['did:key:controller'],
      model: new Uint8Array([1, 2, 3]),
      tags: ['hello'],
    },
  }
  await expect(repository.countAll()).resolves.toEqual(0)
  const stored = await repository.save(input)
  await expect(repository.countAll()).resolves.toEqual(1)
  const now = Date.now()
  expect(stored.streamId).toEqual(input.streamId)
  expect(stored.metadata).toEqual(input.metadata)
  expect(stored.createdAt.valueOf()).toBeCloseTo(now, -2)
  expect(stored.updatedAt.valueOf()).toBeCloseTo(now, -2)
  expect(stored.usedAt.valueOf()).toBeCloseTo(now, -2)
})
