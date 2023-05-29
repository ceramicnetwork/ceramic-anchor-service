import { describe, test, expect } from '@jest/globals'
import { randomCID, randomStreamID } from '../../__tests__/test-utils.js'
import { CommitID, StreamID } from '@ceramicnetwork/streamid'
import type { CID } from 'multiformats/cid'
import { validate, isRight, type Right } from 'codeco'
import { cidAsString, commitIdAsString, date, didString, streamIdAsString } from '../codecs.js'

describe('cidAsString', () => {
  const cid = randomCID()
  test('decode: ok', () => {
    const result = validate(cidAsString, cid.toString())
    expect(isRight(result)).toEqual(true)
    expect((result as Right<CID>).right).toEqual(cid)
  })
  test('decode: not ok', () => {
    const result = validate(cidAsString, 'garbage')
    expect(isRight(result)).toEqual(false)
  })
  test('encode', () => {
    const result = cidAsString.encode(cid)
    expect(result).toEqual(cid.toString())
  })
})

describe('streamIdAsString', () => {
  const streamId = randomStreamID()
  test('decode: ok', () => {
    const result = validate(streamIdAsString, streamId.toString())
    expect(isRight(result)).toEqual(true)
    expect((result as Right<StreamID>).right).toEqual(streamId)
  })
  test('decode: not ok', () => {
    const result = validate(streamIdAsString, 'garbage')
    expect(isRight(result)).toEqual(false)
  })
  test('encode', () => {
    const result = streamIdAsString.encode(streamId)
    expect(result).toEqual(streamId.toString())
  })
})

describe('didString', () => {
  test('ok', () => {
    expect(isRight(validate(didString, 'did:method:foo'))).toBeTruthy()
  })
  test('fail', () => {
    expect(isRight(validate(didString, null))).toBeFalsy()
    expect(isRight(validate(didString, undefined))).toBeFalsy()
    expect(isRight(validate(didString, ''))).toBeFalsy()
    expect(isRight(validate(didString, 'did:method'))).toBeFalsy()
    expect(isRight(validate(didString, 'did:method:id#fragment'))).toBeFalsy()
    expect(isRight(validate(didString, 'garbage'))).toBeFalsy()
  })
})

describe('commitId', () => {
  const STREAM_ID_STRING = 'kjzl6cwe1jw147dvq16zluojmraqvwdmbh61dx9e0c59i344lcrsgqfohexp60s'
  const COMMIT_ID_STRING =
    'k1dpgaqe3i64kjqcp801r3sn7ysi5i0k7nxvs7j351s7kewfzr3l7mdxnj7szwo4kr9mn2qki5nnj0cv836ythy1t1gya9s25cn1nexst3jxi5o3h6qprfyju'

  test('decode: ok', () => {
    const commitId = CommitID.fromString(COMMIT_ID_STRING)
    const result = validate(commitIdAsString, commitId.toString())
    expect(isRight(result)).toBeTruthy()
    const decoded = (result as Right<CommitID>).right
    expect(decoded).toBeInstanceOf(CommitID)
    expect(commitId.equals(decoded)).toBeTruthy()
  })
  test('decode: fail', () => {
    // @ts-ignore TS does not expect `null` as a parameter
    expect(isRight(validate(commitIdAsString, null))).toBeFalsy()
    // @ts-ignore TS does not expect `undefined` as a parameter
    expect(isRight(validate(commitIdAsString, undefined))).toBeFalsy()
    expect(isRight(validate(commitIdAsString, ''))).toBeFalsy()
    expect(isRight(validate(commitIdAsString, 'garbage'))).toBeFalsy()
    // StreamID
    expect(isRight(validate(commitIdAsString, STREAM_ID_STRING))).toBeFalsy()
  })
  test('encode', () => {
    const commitId = CommitID.fromString(COMMIT_ID_STRING)
    expect(commitIdAsString.encode(commitId)).toEqual(COMMIT_ID_STRING)
  })
})

describe('date', () => {
  const isoString = '2022-12-13T14:15:16.789Z'
  const now = new Date(isoString)

  describe('decode', () => {
    test('from ISO string', () => {
      const decoded = validate(date, isoString)
      expect(isRight(decoded)).toBeTruthy()
      expect((decoded as Right<Date>).right).toEqual(now)
    })
    test('from JS Date', () => {
      const decoded = validate(date, now)
      expect(isRight(decoded)).toBeTruthy()
      expect((decoded as Right<Date>).right).toEqual(now)
    })
  })
  test('encode', () => {
    expect(date.encode(now)).toEqual(isoString)
  })
})
