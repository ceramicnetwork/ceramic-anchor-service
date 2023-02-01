import * as t from 'io-ts'
import { CommitID, StreamID } from '@ceramicnetwork/streamid'
import * as uint8arrays from 'uint8arrays'
import { isDIDString } from './did-string.js'

/**
 * io-ts codec for JS `Uint8Array`.
 */
export const uint8array = new t.Type<Uint8Array, Uint8Array, unknown>(
  'Uint8Array',
  (input: unknown): input is Uint8Array => input instanceof Uint8Array,
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
  (input: unknown): input is StreamID => StreamID.isInstance(input),
  (input: string, context: t.Context) => {
    try {
      return t.success(StreamID.fromString(input))
    } catch {
      return t.failure(input, context)
    }
  },
  (streamId) => streamId.toString()
)

/**
 * io-ts codec for CommitID encoded as string.
 */
export const commitIdAsString = new t.Type<CommitID, string, string>(
  'CommitID-as-string',
  (input: unknown): input is CommitID => CommitID.isInstance(input),
  (input: string, context: t.Context) => {
    try {
      return t.success(CommitID.fromString(input))
    } catch {
      return t.failure(input, context)
    }
  },
  (commitId) => commitId.toString()
)

/**
 * io-ts codec for JS `Date` encoded as ISO8601 string, and decoded from string or `Date` instance.
 */
export const date = new t.Type<Date, string, Date | string>(
  'Date-as-ISOString',
  (input: unknown): input is Date => input instanceof Date,
  function (this: t.Type<Date>, input: Date | string, context: t.Context) {
    if (this.is(input)) return t.success(input)
    if (typeof input === 'string') {
      const parsed = new Date(input)
      const isParsingSuccessful = Number.isFinite(parsed.valueOf())
      if (isParsingSuccessful) return t.success(parsed)
    }
    return t.failure(input, context)
  },
  (input: Date) => input.toISOString()
)

/**
 * io-ts codec for a vanilla DID string, i.e. `did:method:id`.
 */
export const didString = t.refinement(t.string, isDIDString, 'did-string')

/**
 * io-ts codec for controllers array: `[DIDString]`.
 */
export const controllers = t.refinement(
  t.array(t.string),
  (array) => array.length === 1,
  '[DIDString]'
)

/**
 * io-ts codec for enums
 * @param enumName - name of the codec
 * @param theEnum - TS enum to pass
 */
export function fromEnum<EnumType>(enumName: string, theEnum: Record<string, string | number>) {
  const isEnumValue = (input: unknown): input is EnumType =>
    Object.values<unknown>(theEnum).includes(input)

  return new t.Type<EnumType>(
    enumName,
    isEnumValue,
    (input, context) => (isEnumValue(input) ? t.success(input) : t.failure(input, context)),
    t.identity
  )
}
export { fromEnum as enum }
