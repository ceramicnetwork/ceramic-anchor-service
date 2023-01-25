import { CAR, CARFactory, CarBlock } from 'cartonne'
import { StreamID } from '@ceramicnetwork/streamid'
import type { CID } from 'multiformats/cid'
import { GenesisFields } from "../models/metadata.js"
import { ThrowDecoder } from "./throw-decoder.js"
import { IpfsGenesisHeader } from "../services/metadata-service"

const DAG_JOSE_CODEC = 133
const DAB_CBOR_CODEC = 113

export class AnchorRequestCarFileReader {
  constructor(readonly carFile: CAR) {}

  private get root(): Record<string, any> {
    const rootCid = this.carFile.roots[0]
    return this.carFile.get(rootCid)
  }

  get timestamp(): Date {
    return new Date(this.root.timestamp)
  }

  get streamId(): StreamID {
    return StreamID.fromBytes(this.root.streamId)
  }

  get tip(): CID {
    return this.root.tip
  }

  get genesisFields(): GenesisFields {
    const genesisCid = this.streamId.cid

    if (genesisCid.code !== DAB_CBOR_CODEC && genesisCid.code !== DAG_JOSE_CODEC) {
      throw Error("Passed a car file with invalid genesis cid - it's not eigher DAG_CBOR, nor DAG_JOSE")
    }

    const genesisRecord = this.carFile.get(genesisCid)
    let genesisFieldsRecord = genesisRecord
    if (genesisCid.code === DAG_JOSE_CODEC) {
      const genesisBlock = this.carFile.get(genesisCid)
      genesisFieldsRecord = this.carFile.get(genesisBlock.link)
    }

    const header = genesisFieldsRecord.header
    return ThrowDecoder.decode(IpfsGenesisHeader, header)
  }
}
