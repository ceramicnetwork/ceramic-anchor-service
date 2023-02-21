import { Request as ExpReq } from 'express'
import { StreamID } from '@ceramicnetwork/streamid'
import type { CID } from 'multiformats/cid'
import { CARFactory } from 'cartonne'
import * as DAG_JOSE from 'dag-jose'
import { GenesisFields } from '../models/metadata.js'
import { AnchorRequestCarFileReader } from './anchor-request-car-file-reader.js'
import * as t from 'io-ts'
import * as te from '../ancillary/io-ts-extra.js'
import * as f from 'fp-ts'

export const RequestAnchorParamsV1 = t.intersection(
  [
    t.type({
      streamId: t.string.pipe(te.streamIdAsString),
      cid: t.string.pipe(te.cidAsString),
    }),
    t.partial({
      timestamp: te.date,
    }),
  ],
  'RequestAnchorParamsV1'
)

export type RequestAnchorParamsV1 = t.TypeOf<typeof RequestAnchorParamsV1>

export declare type RequestAnchorParamsV2 = {
  streamId: StreamID
  timestamp: Date
  cid: CID
  genesisFields: GenesisFields
}

const carFactory = new CARFactory()
carFactory.codecs.add(DAG_JOSE)

export declare type RequestAnchorParams = RequestAnchorParamsV1 | RequestAnchorParamsV2

export function isRequestAnchorParamsV2(
  input: RequestAnchorParams
): input is RequestAnchorParamsV2 {
  return input && (input as RequestAnchorParamsV2).genesisFields != undefined
}

export class AnchorRequestParamsParser {
  parse(req: ExpReq): t.Validation<RequestAnchorParams> {
    if (req.get('Content-Type') !== 'application/vnd.ipld.car') {
      // Legacy requests
      return this._parseReqV1(req)
    } else {
      // Next version of anchor requests, using the CAR file format
      return this._parseReqV2(req)
    }
  }

  private _parseReqV1(req: ExpReq): t.Validation<RequestAnchorParamsV1> {
    return RequestAnchorParamsV1.decode(req.body)
  }

  private _parseReqV2(req: ExpReq): t.Validation<RequestAnchorParamsV2> {
    // TODO: CDB-2212 Store the car file somewhere for future reference/validation of signatures
    // (as it also includes the tip commit and optionally CACAO for the tip commit)
    const car = carFactory.fromBytes(req.body)
    const carReader = new AnchorRequestCarFileReader(car)

    return f.either.right({
      streamId: carReader.streamId,
      timestamp: carReader.timestamp,
      cid: carReader.tip,
      genesisFields: carReader.genesisFields,
    })
  }
}
