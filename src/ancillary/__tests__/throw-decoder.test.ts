import { expect, test } from '@jest/globals'
import { randomStreamID } from '../../__tests__/test-utils.js'
import { ThrowDecoder, ValidationError } from '../throw-decoder.js'
import * as t from 'io-ts'
import * as te from '../io-ts-extra.js'
import { StreamID } from '@ceramicnetwork/streamid'
import { CARFactory } from 'cartonne'
import { readFile } from 'node:fs/promises'
import { IpfsGenesis } from '../../services/metadata-service.js'
import { expectPresent } from '../../__tests__/expect-present.util.js'

test('decode: ok', () => {
  const streamId = randomStreamID()
  const stringDecoded = ThrowDecoder.decode(t.string, 'Hello')
  expect(stringDecoded).toEqual('Hello')
  const streamIdDecoded = ThrowDecoder.decode(te.streamIdAsString, streamId.toString())
  expect(streamIdDecoded).toBeInstanceOf(StreamID)
  expect(streamIdDecoded).toEqual(streamId)
})

test('decode: failure', () => {
  expect(() => ThrowDecoder.decode(t.string, {})).toThrow(/Invalid value: expected string got \{\}/)
  expect(() => {
    ThrowDecoder.decode(te.streamIdAsString, 'garbage')
  }).toThrow('Invalid value: expected StreamID-as-string got "garbage"')
})

test('clear error message', async () => {
  const carFactory = new CARFactory()
  const carFilename = new URL('./big-metadata-genesis.car', import.meta.url)
  const carBytes = await readFile(carFilename)
  const car = carFactory.fromBytes(carBytes)
  const rootCid = car.roots[0]
  expectPresent(rootCid)
  const genesis = car.get(rootCid)
  try {
    ThrowDecoder.decode(IpfsGenesis, genesis)
  } catch (e: any) {
    expect(e).toBeInstanceOf(ValidationError)
    expect(e.message).toMatch(/Invalid value at \/header\/1\/tags\/0: expected string got/)
  }
})
