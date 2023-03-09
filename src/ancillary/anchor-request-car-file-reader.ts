import type { CAR } from 'cartonne'
import type { CID } from 'multiformats/cid'
import { StreamID } from '@ceramicnetwork/streamid'
import { GenesisFields } from '../models/metadata.js'
import { ThrowDecoder } from './throw-decoder.js'
import { IpfsGenesis } from '../services/metadata-service.js'

const DAG_JOSE_CODE = 133
const DAG_CBOR_CODE = 113

export class AnchorRequestCarFileReader {
  constructor(readonly carFile: CAR) {}

  private get root(): Record<string, any> {
    const rootCid = this.carFile.roots[0]
    if (!rootCid) throw new Error(`Can not get root CID`)
    const entry = this.carFile.get(rootCid)
    if (!entry) throw new Error(`Can not get root entry by cid ${rootCid}`)
    return entry
  }

  get timestamp(): Date {
    return new Date(this.root['timestamp'])
  }

  get streamId(): StreamID {
    return StreamID.fromBytes(this.root['streamId'])
  }

  get tip(): CID {
    return this.root['tip']
  }

  get genesisFields(): GenesisFields {
    const genesisCid = this.streamId.cid
    const maybeGenesisRecord = this.retrieveGenesisRecord(genesisCid)
    const genesisRecord = ThrowDecoder.decode(IpfsGenesis, maybeGenesisRecord)
    return genesisRecord.header
  }

  retrieveGenesisRecord(genesisCid: CID): unknown {
    switch (genesisCid.code) {
      case DAG_CBOR_CODE:
        return this.carFile.get(genesisCid)
      case DAG_JOSE_CODE: {
        const genesisJWS = this.carFile.get(genesisCid)
        return this.carFile.get(genesisJWS.link)
      }
      default:
        throw new Error(`Unsupported codec ${genesisCid.code} for genesis CID ${genesisCid}`)
    }
  }
}
