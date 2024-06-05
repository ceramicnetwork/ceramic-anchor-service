import type { CID } from 'multiformats/cid'
import { ServiceMetrics as Metrics } from '@ceramicnetwork/observability'
import { METRIC_NAMES } from '../settings.js'
import { logger } from '../logger/index.js'
import type { RequestRepository } from '../repositories/request-repository.js'
import type { RequestPresentationService } from './request-presentation-service.js'
import type { RequestAnchorParams } from '../ancillary/anchor-request-params-parser.js'
import type { IMetadataService } from './metadata-service.js'
import type { GenesisFields } from '../models/metadata'
import { Request, RequestStatus } from '../models/request.js'
import { Config } from 'node-config-ts'
import { IQueueProducerService } from './queue/queue-service.type.js'
import { RequestQMessage } from '../models/queue-message.js'
import type { OutputOf } from 'codeco'
import type { CASResponse } from '@ceramicnetwork/codecs'
import { IReplicationRequestRepository } from '../repositories/replication-request-repository.js'

const ISO8601_DATE_FORMAT = new Intl.DateTimeFormat('sv-SE', {
  month: '2-digit',
  year: 'numeric',
  day: 'numeric',
})

export class RequestDoesNotExistError extends Error {
  constructor(cid: CID) {
    super(`Request does not exist for cid ${cid.toString()}`)
  }
}

export class RequestService {
  private readonly publishToQueue: boolean

  static inject = [
    'config',
    'requestRepository',
    'replicationRequestRepository',
    'requestPresentationService',
    'metadataService',
    'validationQueueService',
  ] as const

  constructor(
    config: Config,
    private readonly requestRepository: RequestRepository,
    private readonly replicationRequestRepository: IReplicationRequestRepository,
    private readonly requestPresentationService: RequestPresentationService,
    private readonly metadataService: IMetadataService,
    private readonly validationQueueService: IQueueProducerService<RequestQMessage>
  ) {
    this.publishToQueue = Boolean(config.queue.sqsQueueUrl)
  }

  /**
   * Finds a request by CID from read replica first if not found there then from main db
   * @param cid The CID of the request.
   * @returns The request.
   */
  async getStatusForCid(cid: CID): Promise<OutputOf<typeof CASResponse> | { error: string }> {
    let request
    try {
      request = await this.replicationRequestRepository.findByCid(cid)
    } catch (e) {
      logger.err(
        `Error fetching request from db with connecion: ${this.replicationRequestRepository.connectionType} for ${cid}, error: ${e}`
      )
    }
    if (!request) {
      logger.debug(`Request not found in replica db for ${cid}, fetching from main_db`)
      Metrics.count(METRIC_NAMES.REPLICA_DB_REQUEST_NOT_FOUND, 1)
      request = await this.requestRepository.findByCid(cid)
      if (!request) {
        throw new RequestDoesNotExistError(cid)
      }
    }
    logger.debug(
      `Found request for ${cid} of ${request.streamId} created at ${ISO8601_DATE_FORMAT.format(
        request.createdAt
      )}`
    )
    return this.requestPresentationService.body(request)
  }

  /**
   * Finds a request by CID from read replica first if not found there then from main db
   * @param cid The CID of the request.
   * @returns The request.
   */
  async findByCid(cid: CID): Promise<OutputOf<typeof CASResponse> | undefined> {
    let found
    try {
      found = await this.replicationRequestRepository.findByCid(cid)
    } catch (e) {
      logger.err(
        `Error fetching request from db with connecion: ${this.replicationRequestRepository.connectionType} for ${cid}, error: ${e}`
      )
    }
    if (!found) {
      logger.debug(`Request not found in replica db for ${cid}, fetching from main_db`)
      Metrics.count(METRIC_NAMES.REPLICA_DB_REQUEST_NOT_FOUND, 1)
      found = await this.requestRepository.findByCid(cid)
      if (!found) {
        throw new RequestDoesNotExistError(cid)
      }
    }
    return this.requestPresentationService.body(found)
  }

  async create(
    params: RequestAnchorParams,
    origin: string
  ): Promise<OutputOf<typeof CASResponse> | null> {
    let genesisFields: GenesisFields
    if ('genesisFields' in params) {
      genesisFields = params.genesisFields
      await this.metadataService.fill(params.streamId, params.genesisFields)
    } else {
      genesisFields = await this.metadataService.fillFromIpfs(params.streamId)
    }

    const request = new Request()
    request.cid = params.cid.toString()
    request.origin = origin
    request.streamId = params.streamId.toString()
    request.status = RequestStatus.PENDING
    request.message = 'Request is pending.'
    // We don't actually know with certainty that the stream is pinned, since the pinStream
    // call above can fail and swallows errors, but marking it as pinned incorrectly is harmless,
    // and this way we ensure the request is picked up by garbage collection.
    request.pinned = true
    request.timestamp = params.timestamp ?? new Date()

    const storedRequest = await this.requestRepository.create(request)

    // request already exists
    if (!storedRequest) {
      return null
    }

    if (this.publishToQueue) {
      // the validation worker will handle replacing requests
      await this.validationQueueService.sendMessage({
        rid: storedRequest.id,
        cid: storedRequest.cid,
        sid: storedRequest.streamId,
        ts: storedRequest.timestamp,
        crt: storedRequest.createdAt,
        org: origin,
      })
      Metrics.count(METRIC_NAMES.PUBLISH_TO_QUEUE, 1)
    } else {
      await this.requestRepository.markReplaced(storedRequest)
      Metrics.count(METRIC_NAMES.UPDATED_STORED_REQUEST, 1)
    }

    const did = genesisFields?.controllers?.[0]

    const logData = {
      cid: request.cid,
      did,
      schema: genesisFields?.schema,
      family: genesisFields?.family,
      model: genesisFields?.model?.toString() ?? '',
      stream: request.streamId,
      origin: request.origin,
      cacao: 'cacaoDomain' in params ? params.cacaoDomain : '',
    }

    // DO NOT REMOVE - this logging is used by business metrics
    logger.imp(`Anchor request received: ${JSON.stringify(logData)}`)

    return this.requestPresentationService.body(storedRequest)
  }
}
