import { CID } from 'multiformats/cid'
import { CommitID, StreamID } from '@ceramicnetwork/streamid'
import * as uint8arrays from 'uint8arrays'
import { isDIDString } from './did-string.js'
import { array, IContext, identity, refinement, string, TrivialCodec, Type } from 'codeco'

/**
 * codeco codec for JS `Uint8Array`.
 */
export const uint8array = new TrivialCodec(
  'Uint8Array',
  (input: unknown): input is Uint8Array => input instanceof Uint8Array
)

/**
 * codeco codec for Uint8Array as base64-encoded string.
 */
export const uint8ArrayAsBase64 = new Type<Uint8Array, string, string>(
  'Uint8Array-as-base64',
  (input: unknown): input is Uint8Array => input instanceof Uint8Array,
  (input: string, context: IContext) => {
    try {
      return context.success(uint8arrays.fromString(input, 'base64'))
    } catch {
      return context.failure()
    }
  },
  (value: Uint8Array): string => uint8arrays.toString(value, 'base64')
)

/**
 * Passthrough codeco codec for CID.
 */
export const cid = new Type<CID, CID, unknown>(
  'CID',
  (input: unknown): input is CID => {
    try {
      return !!CID.asCID(input)
    } catch (e) {
      return false
    }
  },
  (input: unknown, context: IContext) => {
    try {
      const cid = CID.asCID(input)
      if (!cid) return context.failure(`Value ${cid} can not be accepted as CID`)
      return context.success(cid)
    } catch {
      return context.failure()
    }
  },
  (cid) => cid
)

/**
 * codeco codec for CID encoded as string.
 */
export const cidAsString = new Type<CID, string, string>(
  'CID-as-string',
  (input: unknown): input is CID => {
    try {
      return !!CID.asCID(input)
    } catch (e) {
      return false
    }
  },
  (input: string, context: IContext) => {
    try {
      const cid = CID.parse(input)
      return context.success(cid)
    } catch {
      return context.failure()
    }
  },
  (cid) => cid.toString()
)

/**
 * codeco codec for StreamID encoded as string.
 */
export const streamIdAsString = new Type<StreamID, string, string>(
  'StreamID-as-string',
  (input: unknown): input is StreamID => StreamID.isInstance(input),
  (input: string, context: IContext) => {
    try {
      return context.success(StreamID.fromString(input))
    } catch {
      return context.failure()
    }
  },
  (streamId) => {
    return streamId.toString()
  }
)

/**
 * codeco codec for StreamID encoded as Uint8Array bytes.
 */
export const streamIdAsBytes = new Type<StreamID, Uint8Array, Uint8Array>(
  'StreamID-as-bytes',
  (input: unknown): input is StreamID => StreamID.isInstance(input),
  (input: Uint8Array, context: IContext) => {
    try {
      return context.success(StreamID.fromBytes(input))
    } catch {
      return context.failure()
    }
  },
  (streamId) => streamId.bytes
)

/**
 * codeco codec for CommitID encoded as string.
 */
export const commitIdAsString = new Type<CommitID, string, string>(
  'CommitID-as-string',
  (input: unknown): input is CommitID => CommitID.isInstance(input),
  (input: string, context: IContext) => {
    try {
      return context.success(CommitID.fromString(input))
    } catch {
      return context.failure()
    }
  },
  (commitId) => commitId.toString()
)

/**
 * codeco codec for JS `Date` encoded as ISO8601 string, and decoded from string or `Date` instance.
 */
export const date = new Type<Date, string, unknown>(
  'Date-as-ISOString',
  (input: unknown): input is Date => input instanceof Date,
  function (this: Type<Date>, input: unknown, context: IContext) {
    if (this.is(input)) return context.success(input)
    if (typeof input === 'string') {
      const parsed = new Date(input)
      const isParsingSuccessful = Number.isFinite(parsed.valueOf())
      if (isParsingSuccessful) return context.success(parsed)
    }
    return context.failure()
  },
  (input: Date) => input.toISOString()
)

/**
 * codeco codec for a vanilla DID string, i.e. `did:method:id`.
 */
export const didString = refinement(string, isDIDString, 'did-string')

/**
 * codeco codec for controllers array: `[controllers]`.
 */
export const controllers = refinement(array(string), (arr) => arr.length === 1, '[controllers]')

/**
 * codeco codec for enums
 * @param enumName - name of the codec
 * @param theEnum - TS enum to pass
 */
export function enumCodec<EnumType>(enumName: string, theEnum: Record<string, string | number>) {
  const isEnumValue = (input: unknown): input is EnumType =>
    Object.values<unknown>(theEnum).includes(input)

  return new Type<EnumType>(
    enumName,
    isEnumValue,
    (input, context) => (isEnumValue(input) ? context.success(input) : context.failure()),
    identity
  )
}
export { enumCodec as enum }
