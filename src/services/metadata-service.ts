import type { StreamID } from '@ceramicnetwork/streamid'
import type { IIpfsService } from './ipfs-service.type.js'
import type { GenesisFields, StoredMetadata } from '../models/metadata.js'
import type { GenesisCommit } from '@ceramicnetwork/common'
import { isExact } from 'ts-essentials'
import * as t from 'io-ts'
import * as te from '../ancillary/io-ts-extra.js'
import type { IMetadataRepository } from '../repositories/metadata-repository.js'
import { ThrowDecoder } from '../ancillary/throw-decoder.js'

/**
 * Public interface for MetadataService.
 */
export interface IMetadataService {
  fill(streamId: StreamID): Promise<void>
}

/**
 * Validation for genesis header retrieved from IPFS.
 */
const IpfsGenesisHeader = t.intersection([
  t.type({
    controllers: t.refinement(
      t.array(te.didString),
      (array) => array.length === 1,
      'single element array'
    ),
  }),
  t.partial({
    schema: t.string.pipe(te.commitIdAsString),
    family: t.string,
    tags: t.array(t.string),
    model: te.uint8array,
  }),
])

/**
 * Fails on compile time if there is any divergence between `GenesisFields` and `IpfsGenesisHeader` shapes.
 */
const exactGenesisFields = isExact<GenesisFields>()

export class MetadataService implements IMetadataService {
  static inject = ['metadataRepository', 'ipfsService'] as const

  constructor(
    private readonly metadataRepository: IMetadataRepository,
    private readonly ipfsService: IIpfsService
  ) {}

  /**
   * Retrieve genesis header fields from IPFS, store to the database.
   */
  async fill(streamId: StreamID): Promise<void> {
    const genesisFields = await this.retrieveFromGenesis(streamId)
    await this.storeMetadata(streamId, genesisFields)
  }

  /**
   * Retrieve genesis header fields from IPFS.
   */
  async retrieveFromGenesis(streamId: StreamID): Promise<GenesisFields> {
    const genesisCID = streamId.cid
    const genesisRecord = await this.ipfsService.retrieveRecord<GenesisCommit>(genesisCID)
    const header = genesisRecord.header
    return exactGenesisFields(ThrowDecoder.decode(IpfsGenesisHeader, header))
  }

  /**
   * Store genesis header fields in a database.
   */
  async storeMetadata(streamId: StreamID, fields: GenesisFields): Promise<StoredMetadata> {
    return this.metadataRepository.save({
      streamId: streamId,
      metadata: fields,
    })
  }
}
