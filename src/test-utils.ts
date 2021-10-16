import CID from 'cids'
import { CeramicService } from './services/ceramic-service'
import { IpfsService } from './services/ipfs-service'
import { StreamID, CommitID } from '@ceramicnetwork/streamid'
import { AnchorCommit, MultiQuery, Stream } from '@ceramicnetwork/common'
import dagCBOR from 'ipld-dag-cbor'
import { randomBytes } from '@stablelib/random'

export async function randomCID(): Promise<CID> {
  return dagCBOR.util.cid(randomBytes(32))
}

export class MockIpfsService implements IpfsService {
  private _streams: Record<string, any> = {}

  constructor() {}

  async init(): Promise<void> {
    return null
  }

  async retrieveRecord(cid: CID | string): Promise<any> {
    return this._streams[cid.toString()]
  }

  async storeRecord(record: Record<string, unknown>): Promise<CID> {
    const cid = await randomCID()
    this._streams[cid.toString()] = record
    return cid
  }

  reset() {
    this._streams = {}
  }
}

export class MockCeramicService implements CeramicService {
  constructor(
    private _ipfsService: IpfsService,
    private _streams: Record<string, any> = {},
    private _cidIndex = 0
  ) {}

  async loadStream(streamId: StreamID): Promise<any> {
    return this._streams[streamId.toString()]
  }

  async multiQuery(queries: MultiQuery[]): Promise<Record<string, Stream>> {
    const result = {}
    for (const query of queries) {
      const id = query.streamId.toString()
      const stream = this._streams[id]
      if (stream) {
        result[id] = stream
      }
    }

    return result
  }

  async publishAnchorCommit(streamId: StreamID, anchorCommit: AnchorCommit): Promise<CID> {
    return this._ipfsService.storeRecord(anchorCommit)
  }

  // Mock-only method to control what gets returned by loadStream()
  putStream(id: StreamID | CommitID, stream: any) {
    this._streams[id.toString()] = stream
  }

  // Mock-only method to generate a random base StreamID
  async generateBaseStreamID(): Promise<StreamID> {
    const cid = await randomCID()
    return new StreamID('tile', cid)
  }

  reset() {
    this._cidIndex = 0
    this._streams = {}
  }
}
