import { StreamID } from '@ceramicnetwork/streamid'

type Fields = {}

export class Metadata {
  streamId: StreamID
  createdAt: Date
  updatedAt: Date
  usedAt: Date
  metadata: Fields

  constructor(params: Partial<Metadata>) {
    this.streamId = params.streamId
    this.createdAt = params.createdAt
    this.updatedAt = params.updatedAt
    this.usedAt = params.usedAt
    this.metadata = params.metadata
  }
}
