import { Request as ExpReq } from 'express'
import { StreamID } from '@ceramicnetwork/streamid'
import { toCID } from '@ceramicnetwork/common'
import type { CID } from 'multiformats/cid'
import { CARFactory } from 'cartonne'
import * as DAG_JOSE from 'dag-jose'
import { GenesisFields } from "../models/metadata.js"
import { AnchorRequestCarFileReader } from "./anchor-request-car-file-reader.js"

export declare type RequestAnchorParamsV1 = {
  streamId?: StreamID
  timestamp?: Date
  tip?: CID
}

export declare type RequestAnchorParamsV2 = {
  streamId: StreamID
  timestamp: Date
  tip: CID
  genesisFields: GenesisFields
}

export declare type RequestAnchorParams = RequestAnchorParamsV1 | RequestAnchorParamsV2

export function isRequestAnchorParamsV2(input: RequestAnchorParams): input is RequestAnchorParamsV2 {
  return input && (input as RequestAnchorParamsV2).genesisFields != undefined
}

export class AnchorRequestParamsParser {
  parse(req: ExpReq): RequestAnchorParams {
    if (req.get('Content-Type') !== 'application/vnd.ipld.car') {
      // Legacy requests
      return this._parseReqV1(req)
    } else {
      // Next version of anchor requests, using the CAR file format
      return this._parseReqV2(req)
    }
  }

  private _parseReqV1(req: ExpReq): RequestAnchorParamsV1 {
    return {
      streamId: req.body.streamId ? StreamID.fromString(req.body.streamId) : undefined,
      tip: req.body.cid ? toCID(req.body.cid) : undefined,
      timestamp: req.body.timestamp ? new Date(req.body.timestamp) : undefined,
    }
  }

  private _parseReqV2(req: ExpReq): RequestAnchorParamsV2 {
    const carFactory = new CARFactory()
    carFactory.codecs.add(DAG_JOSE)
    // TODO: CDB-2212 Store the car file somewhere for future reference/validation of signatures
    // (as it also includes the tip commit and optionally CACAO for the tip commit)
    const car = carFactory.fromBytes(req.body)
    const carReader = new AnchorRequestCarFileReader(car)

    return {
      streamId: carReader.streamId,
      timestamp: carReader.timestamp,
      tip: carReader.tip,
      genesisFields: carReader.genesisFields
    }
  }
}
