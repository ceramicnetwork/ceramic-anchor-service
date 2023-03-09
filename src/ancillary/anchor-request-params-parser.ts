import type { Request as ExpReq } from 'express'
import type { CID } from 'multiformats/cid'
import type { StreamID } from '@ceramicnetwork/streamid'
import { CARFactory, type CAR } from 'cartonne'
import * as DAG_JOSE from 'dag-jose'
import { GenesisFields } from '../models/metadata.js'
import * as t from 'io-ts'
import * as te from '../ancillary/io-ts-extra.js'
import { isLeft } from 'fp-ts/lib/Either.js'
import { ThrowDecoder } from './throw-decoder.js'
import { IpfsGenesis } from '../services/metadata-service.js'

const carFactory = new CARFactory()
carFactory.codecs.add(DAG_JOSE)

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

type RequestAnchorParamsV1 = t.TypeOf<typeof RequestAnchorParamsV1>

const RequestAnchorParamsV2Root = t.type({
  streamId: te.uint8array.pipe(te.streamIdAsBytes),
  timestamp: te.date,
  tip: te.cid,
})

export type RequestAnchorParamsV2 = {
  streamId: StreamID
  timestamp: Date
  cid: CID
  genesisFields: GenesisFields
}

export type RequestAnchorParams = RequestAnchorParamsV1 | RequestAnchorParamsV2

const DAG_JOSE_CODE = 133
const DAG_CBOR_CODE = 113

export class AnchorRequestCarFileDecoder implements t.Decoder<Uint8Array, RequestAnchorParamsV2> {
  readonly name = 'RequestAnchorParamsV2'

  decode(bytes: Uint8Array): t.Validation<RequestAnchorParamsV2> {
    return this.validate(bytes, [{ key: '', type: this, actual: bytes }])
  }

  validate(bytes: Uint8Array, context: t.Context): t.Validation<RequestAnchorParamsV2> {
    try {
      const carFile = carFactory.fromBytes(bytes)
      const rootCid = carFile.roots[0]
      if (!rootCid) return t.failure(carFile.roots, context, 'Can not get root CID')
      const rootRecord = carFile.get(rootCid)
      if (!rootRecord)
        return t.failure(rootRecord, context, `Can not get root record by cid ${rootCid}`)
      const rootE = RequestAnchorParamsV2Root.decode(rootRecord)
      if (isLeft(rootE)) return t.failures(rootE.left)
      const root = rootE.right
      const genesisCid = root.streamId.cid
      const maybeGenesisRecord = this.retrieveGenesisRecord(genesisCid, carFile)
      const genesisRecord = ThrowDecoder.decode(IpfsGenesis, maybeGenesisRecord)
      const genesisFields = genesisRecord.header

      return t.success({
        streamId: root.streamId,
        timestamp: root.timestamp,
        cid: root.tip,
        genesisFields: genesisFields,
      })
    } catch (e: any) {
      const message = e.message || String(e)
      return t.failure(bytes, context, `Can not decode CAR file: ${message}`)
    }
  }

  private retrieveGenesisRecord(genesisCid: CID, carFile: CAR): unknown {
    switch (genesisCid.code) {
      case DAG_CBOR_CODE:
        return carFile.get(genesisCid)
      case DAG_JOSE_CODE: {
        const genesisJWS = carFile.get(genesisCid)
        return carFile.get(genesisJWS.link)
      }
      default:
        throw new Error(`Unsupported codec ${genesisCid.code} for genesis CID ${genesisCid}`)
    }
  }
}

export function isRequestAnchorParamsV2(
  input: RequestAnchorParams
): input is RequestAnchorParamsV2 {
  return input && (input as RequestAnchorParamsV2).genesisFields != undefined
}

export class AnchorRequestParamsParser {
  readonly v2decoder = new AnchorRequestCarFileDecoder()

  parse(req: ExpReq): t.Validation<RequestAnchorParams> {
    if (req.get('Content-Type') !== 'application/vnd.ipld.car') {
      // Legacy requests
      return RequestAnchorParamsV1.decode(req.body)
    } else {
      // Next version of anchor requests, using the CAR file format
      // TODO: CDB-2212 Store the car file somewhere for future reference/validation of signatures
      // (as it also includes the tip commit and optionally CACAO for the tip commit)
      return this.v2decoder.decode(req.body)
    }
  }
}
