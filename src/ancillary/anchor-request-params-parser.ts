import type { Request as ExpReq } from 'express'
import type { CID } from 'multiformats/cid'
import type { StreamID } from '@ceramicnetwork/streamid'
import { CARFactory, type CAR } from 'cartonne'
import * as DAG_JOSE from 'dag-jose'
import { GenesisFields } from '../models/metadata.js'
import * as t from 'codeco'
import * as te from './codecs.js'
import { IpfsGenesis } from '../services/metadata-service.js'

const carFactory = new CARFactory()
carFactory.codecs.add(DAG_JOSE)

export const RequestAnchorParamsV1 = t.sparse(
  {
    streamId: t.string.pipe(te.streamIdAsString),
    cid: t.string.pipe(te.cidAsString),
    timestamp: t.optional(te.date),
  },
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

  decode(bytes: Uint8Array, context: t.IContext): t.Validation<RequestAnchorParamsV2> {
    try {
      const carFile = carFactory.fromBytes(bytes)
      const rootCid = carFile.roots[0]
      if (!rootCid) return context.failure('Can not get root CID')
      const rootRecord = carFile.get(rootCid)
      if (!rootRecord) return context.failure(`Can not get root record by cid ${rootCid}`)
      const rootE = RequestAnchorParamsV2Root.decode(rootRecord, context)
      if (t.isLeft(rootE)) return context.failures(rootE.left)
      const root = rootE.right
      const genesisCid = root.streamId.cid
      const maybeGenesisRecord = this.retrieveGenesisRecord(genesisCid, carFile)
      const genesisRecord = t.decode(IpfsGenesis, maybeGenesisRecord)
      const genesisFields = genesisRecord.header

      return context.success({
        streamId: root.streamId,
        timestamp: root.timestamp,
        cid: root.tip,
        genesisFields: genesisFields,
      })
    } catch (e: any) {
      const message = e.message || String(e)
      return context.failure(`Can not decode CAR file: ${message}`)
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

export class AnchorRequestParamsParser {
  readonly v2decoder = new AnchorRequestCarFileDecoder()

  parse(req: ExpReq): t.Validation<RequestAnchorParams> {
    if (req.get('Content-Type') !== 'application/vnd.ipld.car') {
      // Legacy requests
      return t.validate(RequestAnchorParamsV1, req.body)
    } else {
      // Next version of anchor requests, using the CAR file format
      // TODO: CDB-2212 Store the car file somewhere for future reference/validation of signatures
      // (as it also includes the tip commit and optionally CACAO for the tip commit)
      return t.validate(this.v2decoder, req.body)
    }
  }
}
