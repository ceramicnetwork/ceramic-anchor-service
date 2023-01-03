import { test, describe, jest, expect } from '@jest/globals'
import type { Knex } from 'knex'
import { createDbConnection } from '../db-connection.js'
import { randomStreamID } from './test-utils'

let dbConnection: Knex

beforeAll(async () => {
  dbConnection = await createDbConnection()
})

afterAll(async () => {
  await dbConnection.destroy()
})

test('PG _now_ corresponds to JS _now_', async () => {
  const nowJS = new Date()
  const nowPG = await dbConnection
    .table('metadata')
    .insert({ streamId: randomStreamID().toString(), metadata: {} })
    .returning(['usedAt'])
    .then((rows) => rows[0].usedAt)
  const seconds = (timestamp: Date) => Math.floor(timestamp.valueOf() / 1000)
  expect(seconds(nowPG)).toBeCloseTo(seconds(nowJS))
})

test('JS-to-PG conversion ignores timezone', async () => {
  // thus manual conversion to ISO8601 is required
  const timestampWithoutTimezone = '2023-01-02T03:04:05.678'
  const withTimezone = new Date(`${timestampWithoutTimezone}+08:00`) // In Singapore time zone
  const pgTimestamp = await dbConnection
    .table('metadata')
    .insert({ streamId: randomStreamID().toString(), metadata: {}, usedAt: withTimezone })
    .returning('usedAt')
    .then((rows) => rows[0].usedAt as Date)
  console.log('pg.a', timestampWithoutTimezone, withTimezone)
  console.log('pg.0', pgTimestamp)
  const pgTimestamp1 = await dbConnection
    .table('metadata')
    .insert({ streamId: randomStreamID().toString(), metadata: {}, usedAt: withTimezone.toISOString() })
    .returning('usedAt')
    .then((rows) => rows[0].usedAt as Date)
  console.log('pg.1', pgTimestamp1)
  // expect(pgTimestamp.toISOString()).toEqual(`${timestampWithoutTimezone}Z`)
})

test('foo', async () => {
  const now0 = new Date()
  // const now = new Date()
  // const nowZ = now.toISOString()
  // console.log('nowZ', nowZ)
  // const nowSGP = nowZ.replace(/Z$/, '+08:00')
  // console.log('nowSGP', new Date(nowSGP))
  // console.log('now', now)
  // // await dbConnection.table('metadata').insert({ streamId: 'foo', metadata: {}, usedAt: now })
  // // const all = await dbConnection.table('metadata')
  // // console.log('all', all)
})
