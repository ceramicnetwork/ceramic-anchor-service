import type { Request as ExpReq } from 'express'
import { CID as CIDObj } from 'multiformats/cid'
import { CARFactory, type CAR } from 'cartonne'
import { ServiceMetrics as Metrics } from '@ceramicnetwork/observability'
import { base64urlToJSON } from '@ceramicnetwork/common'
import { METRIC_NAMES } from '../settings.js'
import * as DAG_JOSE from 'dag-jose'
import { logger } from '../logger/index.js'
import {
  uint8array,
  cid,
  cidAsString,
  date,
  streamIdAsString,
  streamIdAsBytes,
} from '@ceramicnetwork/codecs'
import {
  optional,
  sparse,
  string,
  strict,
  isLeft,
  validate,
  union,
  type TypeOf,
  type Decoder,
  type Validation,
  type Context,
} from 'codeco'

const carFactory = new CARFactory()
carFactory.codecs.add(DAG_JOSE)

export const RequestAnchorParamsV1 = sparse(
  {
    streamId: string.pipe(streamIdAsString),
    cid: string.pipe(cidAsString),
    timestamp: optional(date),
  },
  'RequestAnchorParamsV1'
)

type RequestAnchorParamsV1 = TypeOf<typeof RequestAnchorParamsV1>

const RequestAnchorParamsV2Root = strict({
  streamId: uint8array.pipe(streamIdAsBytes),
  timestamp: date,
  tip: cid,
})

/**
 * Used to encode request params for logging purposes
 */
export const RequestAnchorParamsV2 = sparse({
  streamId: streamIdAsString,
  timestamp: date,
  cid: cidAsString,
  cacaoDomain: optional(string)
})

export type RequestAnchorParamsV2 = TypeOf<typeof RequestAnchorParamsV2>

export type RequestAnchorParams = RequestAnchorParamsV1 | RequestAnchorParamsV2

/**
 * Encode request params for logging purposes.
 */
export const RequestAnchorParamsCodec = union([RequestAnchorParamsV1, RequestAnchorParamsV2])

export class AnchorRequestCarFileDecoder implements Decoder<Uint8Array, RequestAnchorParamsV2> {
  readonly name = 'RequestAnchorParamsV2'

  decode(bytes: Uint8Array, context: Context): Validation<RequestAnchorParamsV2> {
    try {
      const carFile = carFactory.fromBytes(bytes)
      const rootCid = carFile.roots[0]
      if (!rootCid) return context.failure('Can not get root CID')
      const rootRecord = carFile.get(rootCid)
      if (!rootRecord) return context.failure(`Can not get root record by cid ${rootCid}`)
      const rootE = RequestAnchorParamsV2Root.decode(rootRecord, context)
      if (isLeft(rootE)) return context.failures(rootE.left)
      const root = rootE.right
      const cacaoDomain = this.extractCacaoDomain(rootRecord, carFile)

      return context.success({
        streamId: root.streamId,
        timestamp: root.timestamp,
        cid: root.tip,
        cacaoDomain: cacaoDomain,
      })
    } catch (e: any) {
      const message = e.message || String(e)
      return context.failure(`Can not decode CAR file: ${message}`)
    }
  }

  private extractCacaoDomain(rootRecord: any, carFile: CAR): string {
    try {
      const tipProtectedHeader = base64urlToJSON(carFile.get(rootRecord.tip).signatures[0].protected)
      return carFile.get(CIDObj.parse(tipProtectedHeader['cap'].replace('ipfs://', ''))).p.domain
    } catch (e: any) {
      const message = e.message || String(e)
      logger.warn(`Error extracting cacao: ${message}`)
      return ''
    }
  }

}

export class AnchorRequestParamsParser {
  readonly v2decoder = new AnchorRequestCarFileDecoder()

  parse(req: ExpReq): Validation<RequestAnchorParams> {
    if (req.get('Content-Type') !== 'application/vnd.ipld.car') {
      // Legacy requests
      Metrics.count(METRIC_NAMES.CTRL_LEGACY_REQUESTED, 1)
      return validate(RequestAnchorParamsV1, req.body)
    } else {
      // Next version of anchor requests, using the CAR file format
      // TODO: CDB-2212 Store the car file somewhere for future reference/validation of signatures
      // (as it also includes the tip commit and optionally CACAO for the tip commit)
      Metrics.count(METRIC_NAMES.CTRL_CAR_REQUESTED, 1)
      return validate(this.v2decoder, req.body)
    }
  }
}
