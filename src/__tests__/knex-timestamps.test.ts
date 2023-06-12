import { test, expect, beforeAll, afterAll } from '@jest/globals'
import type { Knex } from 'knex'
import { createDbConnection } from '../db-connection.js'
import { isClose, randomStreamID, seconds } from './test-utils.js'
import { date } from '@ceramicnetwork/codecs'

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
  expect(isClose(seconds(nowPG), seconds(nowJS))).toBeTruthy()
})

test('JS-to-PG conversion ignores timezone', async () => {
  // thus manual conversion to ISO8601 is required
  const timestampWithoutTimezone = '2023-01-02T03:04:05.678'
  const timestampSGP = `${timestampWithoutTimezone}+08:00`
  const withTimezone = new Date(timestampSGP) // In Singapore time zone
  const pgTimestamp = await dbConnection
    .table('metadata')
    .insert({ streamId: randomStreamID().toString(), metadata: {}, usedAt: withTimezone })
    .returning('usedAt')
    .then((rows) => rows[0].usedAt as Date)
  const pastOffsetMinutes = pgTimestamp.getTimezoneOffset() // minutes
  const pastOffsetMs = pastOffsetMinutes * 60 * 1000 // milliseconds
  expect(pgTimestamp.valueOf()).toEqual(withTimezone.valueOf() - pastOffsetMs)
  const pgTimestamp1 = await dbConnection
    .table('metadata')
    .insert({
      streamId: randomStreamID().toString(),
      metadata: {},
      usedAt: date.encode(withTimezone),
    })
    .returning('usedAt')
    .then((rows) => rows[0].usedAt as Date)
  expect(date.encode(pgTimestamp1)).toEqual('2023-01-01T19:04:05.678Z')
})
