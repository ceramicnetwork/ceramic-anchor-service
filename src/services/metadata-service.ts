import type { StreamID } from '@ceramicnetwork/streamid'
import type { IIpfsService, RetrieveRecordOptions } from './ipfs-service.type.js'
import type { GenesisFields, StoredMetadata } from '../models/metadata.js'
import type { GenesisCommit } from '@ceramicnetwork/common'
import * as t from 'io-ts'
import * as te from '../ancillary/io-ts-extra.js'
import type { IMetadataRepository } from '../repositories/metadata-repository.js'
import { ThrowDecoder } from '../ancillary/throw-decoder.js'
import type { AbortOptions } from '../ancillary/abort-options.type.js'
import { IsExact, assert } from 'conditional-type-checks'
import { logger } from '../logger/index.js'

/**
 * Public interface for MetadataService.
 */
export interface IMetadataService {
  fillAll(streamIds: Array<StreamID>, options?: AbortOptions): Promise<void>
  fill(streamId: StreamID, options?: AbortOptions): Promise<void>
  retrieve(streamId: StreamID): Promise<StoredMetadata | undefined>
}

/**
 * Validation for genesis header retrieved from IPFS.
 */
export const IpfsGenesisHeader = t.exact(
  t.intersection([
    t.type({
      controllers: te.controllers,
    }),
    t.partial({
      schema: t.string.pipe(te.commitIdAsString),
      family: t.string,
      tags: t.array(t.string),
      model: te.uint8array.pipe(te.streamIdAsBytes),
    }),
  ])
)

/**
 * Fails on compile time if there is any divergence between `GenesisFields` and `IpfsGenesisHeader` shapes.
 * The function is a no-op.
 */
assert<IsExact<GenesisFields, t.TypeOf<typeof IpfsGenesisHeader>>>(true)

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

  /**
   * Retrieve genesis header fields from IPFS, store to the database.
   */
  async fill(streamId: StreamID, options: AbortOptions = {}): Promise<void> {
    const isPresent = await this.metadataRepository.isPresent(streamId)
    if (isPresent) return // Do not perform same work of retrieving from IPFS twice
    const genesisFields = await this.retrieveFromGenesis(streamId, options)
    await this.storeMetadata(streamId, genesisFields)
    logger.debug(`Filled metadata from IPFS for ${streamId}`)
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
    const genesisRecord = await this.ipfsService.retrieveRecord<GenesisCommit>(
      genesisCID,
      retrieveRecordOptions
    )
    const header = genesisRecord.header
    return ThrowDecoder.decode(IpfsGenesisHeader, header)
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

  async fillAll(streamIds: Array<StreamID>, options?: AbortOptions): Promise<void> {
    await Promise.all(
      streamIds.map(async (streamId) => {
        try {
          await this.fill(streamId, options)
        } catch (e) {
          logger.err(`Can not fill metadata for ${streamId}: ${e}`)
        }
      })
    )
  }
}
