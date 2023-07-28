import 'reflect-metadata'
import 'dotenv/config'

import { Config } from 'node-config-ts'
import type { Knex } from 'knex'
import { logger } from './logger/index.js'
import { CeramicAnchorServer } from './server.js'
import { METRIC_NAMES } from './settings.js'
import { IpfsService } from './services/ipfs-service.js'
import type { IIpfsService } from './services/ipfs-service.type.js'
import { AnchorService } from './services/anchor-service.js'
import { TaskSchedulerService } from './services/task-scheduler-service.js'
import { BlockchainService } from './services/blockchain/blockchain-service.js'
import { HTTPEventProducerService } from './services/event-producer/http/http-event-producer-service.js'
import { AnchorRepository } from './repositories/anchor-repository.js'
import { RequestRepository } from './repositories/request-repository.js'
import { TransactionRepository } from './repositories/transaction-repository.js'
import { HealthcheckController } from './controllers/healthcheck-controller.js'
import { AnchorController } from './controllers/anchor-controller.js'
import { RequestController } from './controllers/request-controller.js'
import { ServiceInfoController } from './controllers/service-info-controller.js'
import { EthereumBlockchainService } from './services/blockchain/ethereum/ethereum-blockchain-service.js'
import {
  DEFAULT_TRACE_SAMPLE_RATIO,
  ServiceMetrics as Metrics,
} from '@ceramicnetwork/observability'
import { version } from './version.js'
import { cleanupConfigForLogging, normalizeConfig } from './normalize-config.util.js'
import type { Injector } from 'typed-inject'
import type { EventProducerService } from './services/event-producer/event-producer-service.js'
import { RequestPresentationService } from './services/request-presentation-service.js'
import type { IMetadataService } from './services/metadata-service.js'
import { MetadataService } from './services/metadata-service.js'
import { MetadataRepository } from './repositories/metadata-repository.js'
import { AppMode } from './app-mode.js'
import { UnreachableCaseError } from '@ceramicnetwork/common'
import { AnchorRequestParamsParser } from './ancillary/anchor-request-params-parser.js'
import { HealthcheckService, IHealthcheckService } from './services/healthcheck-service.js'
import { RequestService } from './services/request-service.js'
import {
  AnchorBatchSqsQueueService,
  ValidationSqsQueueService,
} from './services/queue/sqs-queue-service.js'
import { makeMerkleCarService, type IMerkleCarService } from './services/merkle-car-service.js'
import { WitnessService } from './services/witness-service.js'

type DependenciesContext = {
  config: Config
  dbConnection: Knex
}

type ProvidedContext = {
  anchorService: AnchorService
  requestRepository: RequestRepository
  anchorRepository: AnchorRepository
  transactionRepository: TransactionRepository
  blockchainService: BlockchainService
  eventProducerService: EventProducerService
  ipfsService: IIpfsService
  markReadyScheduler: TaskSchedulerService
  requestPresentationService: RequestPresentationService
  metadataService: IMetadataService
  healthcheckService: IHealthcheckService
  anchorRequestParamsParser: AnchorRequestParamsParser
  requestService: RequestService
  merkleCarService: IMerkleCarService
  continualAnchoringScheduler: TaskSchedulerService
  witnessService: WitnessService
} & DependenciesContext

/**
 * Ceramic Anchor Service application
 */
export class CeramicAnchorApp {
  private _server?: CeramicAnchorServer
  readonly container: Injector<ProvidedContext>
  private readonly config: Config
  private readonly mode: AppMode
  private readonly anchorsSupported: boolean

  constructor(container: Injector<DependenciesContext>) {
    this.config = container.resolve('config')
    normalizeConfig(this.config)
    this.mode = this.config.mode as AppMode
    this.anchorsSupported =
      this.mode === AppMode.ANCHOR ||
      this.mode === AppMode.BUNDLED ||
      this.mode === AppMode.CONTINUAL_ANCHORING ||
      this.config.anchorControllerEnabled

    // TODO: Selectively register only the global singletons needed based on the config

    this.container = container
      // register repositories
      .provideClass('metadataRepository', MetadataRepository)
      .provideFactory('requestRepository', RequestRepository.make)
      .provideClass('anchorRepository', AnchorRepository)
      .provideClass('transactionRepository', TransactionRepository)
      // register services
      .provideFactory('blockchainService', EthereumBlockchainService.make)
      .provideClass('eventProducerService', HTTPEventProducerService)
      .provideClass('ipfsService', IpfsService)
      .provideClass('metadataService', MetadataService)
      .provideClass('anchorBatchQueueService', AnchorBatchSqsQueueService)
      .provideClass('validationQueueService', ValidationSqsQueueService)
      .provideFactory('merkleCarService', makeMerkleCarService)
      .provideClass('anchorService', AnchorService)
      .provideClass('markReadyScheduler', TaskSchedulerService)
      .provideClass('healthcheckService', HealthcheckService)
      .provideClass('witnessService', WitnessService)
      .provideClass('requestPresentationService', RequestPresentationService)
      .provideClass('anchorRequestParamsParser', AnchorRequestParamsParser)
      .provideClass('requestService', RequestService)
      .provideClass('continualAnchoringScheduler', TaskSchedulerService)

    try {
      Metrics.start(
        this.config.metrics.collectorHost,
        'cas_' + this.mode,
        DEFAULT_TRACE_SAMPLE_RATIO,
        null,
        false
      )
      Metrics.count('HELLO', 1)
      logger.imp('Metrics exporter started')
    } catch (e: any) {
      logger.imp('ERROR: Metrics exporter failed to start. Continuing anyway.')
      logger.err(e)
      // start anchor service even if metrics threw an error
    }
  }

  async anchor(): Promise<void> {
    const anchorService = this.container.resolve('anchorService')
    await anchorService.anchorRequests()
  }

  /**
   * Start application
   */
  async start(): Promise<void> {
    const configLogString = JSON.stringify(cleanupConfigForLogging(this.config), null, 2)
    logger.imp(
      `Starting Ceramic Anchor Service at version ${version} with config:\n${configLogString}`
    )

    const blockchainService = this.container.resolve('blockchainService')
    await blockchainService.connect()

    if (this.anchorsSupported) {
      const ipfsService = this.container.resolve('ipfsService')
      await ipfsService.init()
    }

    switch (this.mode) {
      case AppMode.SERVER:
        await this._startServer()
        break
      case AppMode.ANCHOR:
        await this._startAnchorAndGarbageCollection()
        break
      case AppMode.BUNDLED:
        await this._startBundled()
        break
      case AppMode.SCHEDULER:
        await this._startScheduler()
        break
      case AppMode.CONTINUAL_ANCHORING:
        await this._startContinualAnchoring()
        break
      default:
        throw new UnreachableCaseError(this.mode, `Unknown application mode ${this.mode}`)
    }
    logger.imp(`Ceramic Anchor Service initiated ${this.mode} mode`)
  }

  async stop(): Promise<void> {
    const markReadyScheduler = this.container.resolve('markReadyScheduler')
    const continualAnchoringScheduler = this.container.resolve('continualAnchoringScheduler')

    await Promise.all([markReadyScheduler.stop(), continualAnchoringScheduler.stop()])

    this._server?.stop()
  }

  /**
   * Starts the application in scheduler mode. In this mode the application will periodically create a
   * batch of requests to process by changing their status to READY. If a batch was created an `anchor`
   * event will be emitted to signal that an anchor needs to be performed.The application will not create
   * a new READY batch until the last batch has been marked as PROCESSING. If the batch has not been serviced
   * in a timely manner a new event will be emitted.
   * @private
   */
  private async _startScheduler(): Promise<void> {
    const anchorService = this.container.resolve('anchorService')
    const markReadyScheduler = this.container.resolve('markReadyScheduler')
    markReadyScheduler.start(
      async () => await anchorService.emitAnchorEventIfReady(),
      this.config.schedulerIntervalMS
    )
  }

  /**
   * Starts bundled application (API + periodic anchoring)
   * @private
   */
  private async _startBundled(): Promise<void> {
    const anchorService = this.container.resolve('anchorService')
    const markReadyScheduler = this.container.resolve('markReadyScheduler')
    markReadyScheduler.start(async () => {
      await anchorService.anchorRequests()
    })
    await this._startServer()
  }

  /**
   * Start application in Server mode, which will accept and store anchor requests in a database, but not actually submit any anchors to the blockchain.
   * @private
   */
  private async _startServer(): Promise<void> {
    const controllers: Array<any> = [
      this.container.injectClass(HealthcheckController),
      this.container.injectClass(ServiceInfoController),
      this.container.injectClass(RequestController),
    ]
    if (this.config.anchorControllerEnabled) {
      const anchorController = this.container.injectClass(AnchorController)
      controllers.push(anchorController)
    }
    this._server = new CeramicAnchorServer(controllers, this.config)
    await this._server.start(this.config.port)
  }

  /**
   * Starts application in anchoring mode, without the API server. This will cause the process to
   * startup, read the database for pending anchors requests, and perform a single anchor on chain
   * before shutting down.
   * If the anchor is successful, will also perform a round of garbage collecting old pinned streams
   * before shutting down.
   * @private
   */
  private async _startAnchorAndGarbageCollection(): Promise<void> {
    const anchorService = this.container.resolve('anchorService')
    await anchorService.anchorRequests().catch((error) => {
      logger.err(`Error when anchoring: ${error}`)
      Metrics.count(METRIC_NAMES.ERROR_WHEN_ANCHORING, 1, {
        message: error.message.substring(0, 50),
      })
      logger.err('Exiting')
      process.exit(1)
    })
    logger.imp(
      `Temporarily skipping stream garbage collection to avoid unpinning important streams from private node`
    )

    // TODO: Uncomment once CAS has its own Ceramic node
    // await anchorService.garbageCollectPinnedStreams().catch((error) => {
    //   logger.err(`Error when garbage collecting pinned streams: ${error}`)
    //   logger.err('Exiting')
    //   process.exit(1)
    // })
    process.exit()
  }

  private async _startContinualAnchoring(): Promise<void> {
    const anchorService = this.container.resolve('anchorService')
    const continualAnchoringScheduler = this.container.resolve('continualAnchoringScheduler')

    const controller = new AbortController()
    let shutdownInProgress: Promise<void> | undefined
    const shutdownSignalHandler = () => {
      if (!shutdownInProgress) {
        logger.imp('Gracefully shutting down continual anchoring')
        controller.abort()
        shutdownInProgress = this.stop()
          .then(() => {
            process.exit(0)
          })
          .catch((error) => {
            console.error(error)
            process.exit(1)
          })
      }
    }
    process.on('SIGINT', shutdownSignalHandler)
    process.on('SIGTERM', shutdownSignalHandler)
    process.on('SIGQUIT', shutdownSignalHandler)

    const task = async (): Promise<boolean> => {
      const success = await anchorService.anchorRequests({ signal: controller.signal }).catch((error: Error) => {
        logger.err(`Error when anchoring: ${error}`)
        Metrics.count(METRIC_NAMES.ERROR_WHEN_ANCHORING, 1, {
          message: error.message.substring(0, 50),
        })
        throw error
      })

      logger.imp(
        `Temporarily skipping stream garbage collection to avoid unpinning important streams from private node`
      )
      // TODO: Uncomment once CAS has its own Ceramic node
      // await anchorService.garbageCollectPinnedStreams().catch((error) => {
      //   logger.err(`Error when garbage collecting pinned streams: ${error}`)
      // })

      return success
    }


    const cbAfterEmptyBatch = () => {
      logger.imp('No batches available. Continual anchoring is shutting down.')
      process.exit(0)
    }

    continualAnchoringScheduler.start(task, this.config.schedulerIntervalMS, this.config.schedulerStopAfterFail ? cbAfterEmptyBatch : undefined)
  }
}
