import { expect, test } from '@jest/globals'
import { randomStreamID } from '../../__tests__/test-utils.js'
import { ThrowDecoder } from '../throw-decoder.js'
import * as t from 'io-ts'
import * as te from '../io-ts-extra.js'
import { StreamID } from '@ceramicnetwork/streamid'

test('decode: ok', () => {
  const streamId = randomStreamID()
  const stringDecoded = ThrowDecoder.decode(t.string, 'Hello')
  expect(stringDecoded).toEqual('Hello')
  const streamIdDecoded = ThrowDecoder.decode(te.streamIdAsString, streamId.toString())
  expect(streamIdDecoded).toBeInstanceOf(StreamID)
  expect(streamIdDecoded).toEqual(streamId)
})

test('decode: failure', () => {
  expect(() => ThrowDecoder.decode(t.string, {})).toThrow(
    /Validation error: Invalid value \{\} supplied to : string/
  )
  expect(() => {
    ThrowDecoder.decode(te.streamIdAsString, 'garbage')
  }).toThrow(/Validation error: Can not decode garbage as StreamID/)
})
