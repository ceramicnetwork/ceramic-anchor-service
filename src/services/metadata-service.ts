import type { StreamID } from '@ceramicnetwork/streamid'
import type { IIpfsService, RetrieveRecordOptions } from './ipfs-service.type.js'
import type { GenesisFields, StoredMetadata } from '../models/metadata.js'
import type { IMetadataRepository } from '../repositories/metadata-repository.js'
import type { AbortOptions } from './abort-options.type.js'
import { assert, type IsExact } from 'conditional-type-checks'
import { logger } from '../logger/index.js'
import { strict, array, exact, optional, sparse, string, decode, type TypeOf } from 'codeco'
import { controllers } from '../ancillary/codecs.js'
import { commitIdAsString, streamIdAsBytes, uint8array } from '@ceramicnetwork/codecs'

/**
 * Public interface for MetadataService.
 */
export interface IMetadataService {
  fill(streamId: StreamID, genesisFields: GenesisFields): Promise<void>
  fillAllFromIpfs(streamIds: Array<StreamID>, options?: AbortOptions): Promise<void>
  fillFromIpfs(streamId: StreamID, options?: AbortOptions): Promise<GenesisFields>
  retrieve(streamId: StreamID): Promise<StoredMetadata | undefined>
}

/**
 * Codec for genesis header retrieved from IPFS.
 */
export const IpfsGenesisHeader = exact(
  sparse(
    {
      controllers: controllers,
      schema: optional(string.pipe(commitIdAsString)),
      family: optional(string),
      tags: optional(array(string)),
      model: optional(uint8array.pipe(streamIdAsBytes)),
    },
    'IpfsGenesisHeader'
  )
)

/**
 * Codec for genesis content retrieved from IPFS. Only `header` field is extracted here.
 */
export const IpfsGenesis = strict({ header: IpfsGenesisHeader }, 'IpfsGenesis')

/**
 * Fails on compile time if there is any divergence between `GenesisFields` and `IpfsGenesisHeader` shapes.
 * The function is a no-op.
 */
assert<IsExact<GenesisFields, TypeOf<typeof IpfsGenesisHeader>>>(true)

/**
 * Identifier of DAG-JOSE codec.
 */
const DAG_JOSE_CODEC = 133

export class MetadataService implements IMetadataService {
  static inject = ['metadataRepository', 'ipfsService'] as const

  constructor(
    private readonly metadataRepository: IMetadataRepository,
    private readonly ipfsService: IIpfsService
  ) {}

  async fill(streamId: StreamID, genesisFields: GenesisFields): Promise<void> {
    await this.storeMetadata(streamId, genesisFields)
    logger.debug(`Filled metadata from a CAR file for ${streamId}`)
  }

  /**
   * Retrieve genesis header fields from IPFS, store to the database.
   */
  async fillFromIpfs(streamId: StreamID, options: AbortOptions = {}): Promise<GenesisFields> {
    const storedFields = await this.metadataRepository.retrieve(streamId)
    if (storedFields) return storedFields.metadata // Do not perform same work of retrieving from IPFS twice
    const genesisFields = await this.retrieveFromGenesis(streamId, options)
    await this.storeMetadata(streamId, genesisFields)
    logger.debug(`Filled metadata from IPFS for ${streamId}`)
    return genesisFields
  }

  /**
   * Retrieve genesis header fields from IPFS.
   */
  async retrieveFromGenesis(
    streamId: StreamID,
    options: AbortOptions = {}
  ): Promise<GenesisFields> {
    const genesisCID = streamId.cid
    const retrieveRecordOptions: RetrieveRecordOptions = {
      signal: options.signal,
    }
    if (genesisCID.code === DAG_JOSE_CODEC) {
      retrieveRecordOptions.path = '/link'
    }
    const genesisRecord = await this.ipfsService.retrieveRecord(genesisCID, retrieveRecordOptions)
    const genesis = decode(IpfsGenesis, genesisRecord)
    return genesis.header
  }

  async retrieve(streamId: StreamID): Promise<StoredMetadata | undefined> {
    return this.metadataRepository.retrieve(streamId)
  }

  /**
   * Store genesis header fields in a database.
   */
  async storeMetadata(streamId: StreamID, fields: GenesisFields): Promise<void> {
    await this.metadataRepository.save({
      streamId: streamId,
      metadata: fields,
    })
  }

  async fillAllFromIpfs(streamIds: Array<StreamID>, options?: AbortOptions): Promise<void> {
    await Promise.all(
      streamIds.map(async (streamId) => {
        try {
          await this.fillFromIpfs(streamId, options)
        } catch (e) {
          logger.err(`Can not fill metadata for ${streamId}: ${e}`)
        }
      })
    )
  }
}
