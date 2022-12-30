import { describe, test, expect } from '@jest/globals'
import * as te from '../io-ts-extra.js'
import { isRight, Right } from 'fp-ts/Either'
import { randomStreamID } from '../../__tests__/test-utils.js'
import { CommitID, StreamID } from '@ceramicnetwork/streamid'

describe('streamIdAsString', () => {
  const streamId = randomStreamID()
  test('decode: ok', () => {
    const result = te.streamIdAsString.decode(streamId.toString())
    expect(isRight(result)).toEqual(true)
    expect((result as Right<StreamID>).right).toEqual(streamId)
  })
  test('decode: not ok', () => {
    const result = te.streamIdAsString.decode('garbage')
    expect(isRight(result)).toEqual(false)
  })
  test('encode', () => {
    const result = te.streamIdAsString.encode(streamId)
    expect(result).toEqual(streamId.toString())
  })
})

describe('didString', () => {
  test('ok', () => {
    expect(isRight(te.didString.decode('did:method:foo'))).toBeTruthy()
  })
  test('fail', () => {
    expect(isRight(te.didString.decode(null))).toBeFalsy()
    expect(isRight(te.didString.decode(undefined))).toBeFalsy()
    expect(isRight(te.didString.decode(''))).toBeFalsy()
    expect(isRight(te.didString.decode('did:method'))).toBeFalsy()
    expect(isRight(te.didString.decode('did:method:id#fragment'))).toBeFalsy()
    expect(isRight(te.didString.decode('garbage'))).toBeFalsy()
  })
})

describe('commitId', () => {
  const STREAM_ID_STRING = 'kjzl6cwe1jw147dvq16zluojmraqvwdmbh61dx9e0c59i344lcrsgqfohexp60s'
  const COMMIT_ID_STRING =
    'k1dpgaqe3i64kjqcp801r3sn7ysi5i0k7nxvs7j351s7kewfzr3l7mdxnj7szwo4kr9mn2qki5nnj0cv836ythy1t1gya9s25cn1nexst3jxi5o3h6qprfyju'

  test('decode: ok', () => {
    const commitId = CommitID.fromString(COMMIT_ID_STRING)
    const result = te.commitIdAsString.decode(commitId.toString())
    expect(isRight(result)).toBeTruthy()
    const decoded = (result as Right<CommitID>).right
    expect(decoded).toBeInstanceOf(CommitID)
    expect(commitId.equals(decoded)).toBeTruthy()
  })
  test('decode: fail', () => {
    expect(isRight(te.commitIdAsString.decode(null))).toBeFalsy()
    expect(isRight(te.commitIdAsString.decode(undefined))).toBeFalsy()
    expect(isRight(te.commitIdAsString.decode(''))).toBeFalsy()
    expect(isRight(te.commitIdAsString.decode('garbage'))).toBeFalsy()
    // StreamID
    expect(isRight(te.commitIdAsString.decode(STREAM_ID_STRING))).toBeFalsy()
  })
  test('encode', () => {
    const commitId = CommitID.fromString(COMMIT_ID_STRING)
    expect(te.commitIdAsString.encode(commitId)).toEqual(COMMIT_ID_STRING)
  })
})

describe('date', () => {
  const isoString = '2022-12-13T14:15:16.789Z'
  const now = new Date(isoString)

  describe('decode', () => {
    test('from ISO string', () => {
      const decoded = te.date.decode(isoString)
      expect(isRight(decoded)).toBeTruthy()
      expect((decoded as Right<Date>).right).toEqual(now)
    })
    test('from JS Date', () => {
      const decoded = te.date.decode(now)
      expect(isRight(decoded)).toBeTruthy()
      expect((decoded as Right<Date>).right).toEqual(now)
    })
  })
  test('encode', () => {
    expect(te.date.encode(now)).toEqual(isoString)
  })
})
