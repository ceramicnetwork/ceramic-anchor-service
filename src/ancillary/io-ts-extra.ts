import * as t from 'io-ts'
import { CommitID, StreamID } from '@ceramicnetwork/streamid'
import * as uint8arrays from 'uint8arrays'
import { isDIDString, DIDString } from './did-string.js'

/**
 * io-ts codec for JS `Uint8Array`.
 */
export const uint8array = new t.Type<Uint8Array, Uint8Array, unknown>(
  'Uint8Array',
  function (input: unknown): input is Uint8Array {
    return input instanceof Uint8Array
  },
  function (this: t.Type<Uint8Array, Uint8Array, unknown>, input: unknown, context: t.Context) {
    return this.is(input) ? t.success(input) : t.failure(input, context)
  },
  t.identity
)

/**
 * io-ts codec for Uint8Array as base64-encoded string.
 */
export const uint8ArrayAsBase64 = new t.Type<Uint8Array, string, string>(
  'Uint8Array-as-base64',
  (input: unknown): input is Uint8Array => input instanceof Uint8Array,
  (input: string, context: t.Context) => {
    try {
      return t.success(uint8arrays.fromString(input, 'base64'))
    } catch {
      return t.failure(input, context)
    }
  },
  (value: Uint8Array): string => uint8arrays.toString(value, 'base64')
)

/**
 * io-ts codec for StreamID encoded as string.
 */
export const streamIdAsString = new t.Type<StreamID, string, string>(
  'StreamID-as-string',
  function (input: unknown): input is StreamID {
    return StreamID.isInstance(input)
  },
  function (this: t.Type<StreamID, string, string>, input: string, context: t.Context) {
    try {
      return t.success(StreamID.fromString(input))
    } catch {
      return t.failure(input, context)
    }
  },
  function (streamId) {
    return streamId.toString()
  }
)

/**
 * io-ts codec for CommitID encoded as string.
 */
export const commitIdAsString = new t.Type<CommitID, string, string>(
  'CommitID-as-string',
  function (input: unknown): input is CommitID {
    return CommitID.isInstance(input)
  },
  function (this: t.Type<CommitID, string, string>, input: string, context: t.Context) {
    try {
      return t.success(CommitID.fromString(input))
    } catch {
      return t.failure(input, context)
    }
  },
  function (commitId) {
    return commitId.toString()
  }
)

/**
 * io-ts codec for JS `Date` encoded as ISO8601 string, and decoded from string or `Date` instance.
 */
export const date = new t.Type<Date, string, Date | string>(
  'Date-as-ISOString',
  function (input: unknown): input is Date {
    return input instanceof Date
  },
  function (this: t.Type<Date>, input: Date | string, context: t.Context) {
    if (this.is(input)) return t.success(input)
    if (typeof input === 'string') {
      const parsed = new Date(input)
      if (isNaN(parsed.valueOf())) {
        // Can not parse input
        return t.failure(input, context)
      }
      return t.success(parsed)
    }
    return t.failure(input, context)
  },
  function (input: Date) {
    return input.toISOString()
  }
)

/**
 * io-ts codec for a vanilla DID string, i.e. `did:method:id`.
 */
export const didString: t.RefinementC<t.StringC, DIDString> = t.refinement(
  t.string,
  isDIDString,
  'did-string'
)
