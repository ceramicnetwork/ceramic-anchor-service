import type { Knex } from 'knex'
import { StreamID } from '@ceramicnetwork/streamid'
import type { IIpfsService } from './ipfs-service.type.js'

export interface IMetadataService {
  // store(streamId: StreamID): Promise<void>
  retrieveFromGenesis(streamId: StreamID): Promise<any>
}

export class MetadataService implements IMetadataService {
  static inject = ['dbConnection', 'ipfsService'] as const

  constructor(private readonly connection: Knex, private readonly ipfsService: IIpfsService) {}

  async fill(streamId: StreamID): Promise<void> {}

  retrieveFromGenesis(streamId: StreamID): Promise<any> {
    return Promise.resolve(undefined)
  }
}
