// TODO Replace from @ceramicnetwork/codes when released
import {
  type,
  string,
  sparse,
  optional,
  literal,
  union,
  Type,
  type TypeOf,
  type Context,
} from 'codeco'
import { cidAsString, streamIdAsString, uint8ArrayAsBase64 } from '@ceramicnetwork/codecs'
import { CARFactory, CAR } from 'cartonne'
import * as DAG_JOSE from 'dag-jose'

const carFactory = new CARFactory()
carFactory.codecs.add(DAG_JOSE)

/**
 * codeco codec for CAR file encoded as a Uint8Array.
 */
export const carAsUint8Array = new Type<CAR, Uint8Array, Uint8Array>(
  'CAR-as-uint8array',
  (input: unknown): input is CAR => {
    return input != null && input instanceof CAR
  },
  (input: Uint8Array, context: Context) => {
    try {
      return context.success(carFactory.fromBytes(input))
    } catch {
      return context.failure()
    }
  },
  (car) => car.bytes
)

export enum RequestStatusName {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  READY = 'READY',
  REPLACED = 'REPLACED',
}

export const CommitPresentation = sparse(
  {
    content: optional(
      sparse({ path: optional(string), prev: string, proof: optional(string) }, 'content')
    ),
    cid: string.pipe(cidAsString),
  },
  'CommitPresentation'
)
export type CommitPresentation = TypeOf<typeof CommitPresentation>

export const NotCompleteStatusName = union([
  literal(RequestStatusName.PENDING),
  literal(RequestStatusName.PROCESSING),
  literal(RequestStatusName.FAILED),
  literal(RequestStatusName.READY),
  literal(RequestStatusName.REPLACED),
])
export type NotCompleteStatusName = TypeOf<typeof NotCompleteStatusName>

export const NotCompleteCASResponse = sparse(
  {
    status: NotCompleteStatusName,
    streamId: streamIdAsString,
    cid: cidAsString,
    message: string,
  },
  'NotCompleteCASResponse'
)
export type NotCompleteCASResponse = TypeOf<typeof NotCompleteCASResponse>

export const CompleteCASResponse = type(
  {
    ...NotCompleteCASResponse.props,
    status: literal(RequestStatusName.COMPLETED),
    anchorCommit: CommitPresentation,
    witnessCar: uint8ArrayAsBase64.pipe(carAsUint8Array),
  },
  'CompleteCASResponse'
)
export type CompleteCASResponse = TypeOf<typeof CompleteCASResponse>

export const CASResponse = union([NotCompleteCASResponse, CompleteCASResponse], 'CASResponse')
export type CASResponse = TypeOf<typeof CASResponse>

export const ErrorResponse = type(
  {
    error: string,
  },
  'ErrorResponse'
)
export type ErrorResponse = TypeOf<typeof ErrorResponse>

export const CASResponseOrError = union([CASResponse, ErrorResponse], 'CASResponseOrError')
export type CASResponseOrError = TypeOf<typeof CASResponseOrError>
