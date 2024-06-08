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
import { ReplicationRequestRepository } from './repositories/replication-request-repository.js'
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
import { AppMode } from './app-mode.js'
import { UnreachableCaseError } from '@ceramicnetwork/common'
import { AnchorRequestParamsParser } from './ancillary/anchor-request-params-parser.js'
import { HealthcheckService, IHealthcheckService } from './services/healthcheck-service.js'
import { RequestService } from './services/request-service.js'
import {
  AnchorBatchSqsQueueService,
  IpfsQueueService,
  ValidationSqsQueueService,
} from './services/queue/sqs-queue-service.js'
import { makeMerkleCarService, type IMerkleCarService } from './services/merkle-car-service.js'
import { makeWitnessService, type IWitnessService } from './services/witness-service.js'

type DependenciesContext = {
  config: Config
  dbConnection: Knex
  replicaDbConnection: { connection: Knex; type: string }
}

type ProvidedContext = {
  anchorService: AnchorService
  requestRepository: RequestRepository
  replicationRequestRepository: ReplicationRequestRepository
  anchorRepository: AnchorRepository
  transactionRepository: TransactionRepository
  blockchainService: BlockchainService
  eventProducerService: EventProducerService
  ipfsService: IIpfsService
  markReadyScheduler: TaskSchedulerService
  requestPresentationService: RequestPresentationService
  healthcheckService: IHealthcheckService
  anchorRequestParamsParser: AnchorRequestParamsParser
  requestService: RequestService
  merkleCarService: IMerkleCarService
  continualAnchoringScheduler: TaskSchedulerService
  witnessService: IWitnessService
} & DependenciesContext

/**
 * Ceramic Anchor Service application
 */
export class CeramicAnchorApp {
  private _server?: CeramicAnchorServer
  readonly container: Injector<ProvidedContext>
  private readonly config: Config
  private readonly mode: AppMode
  private readonly usesIpfs: boolean

  constructor(container: Injector<DependenciesContext>) {
    this.config = container.resolve('config')
    normalizeConfig(this.config)
    this.mode = this.config.mode as AppMode
    this.usesIpfs =
      this.mode === AppMode.ANCHOR ||
      this.mode === AppMode.BUNDLED ||
      this.mode === AppMode.CONTINUAL_ANCHORING ||
      this.mode === AppMode.PUBSUB_RESPONDER ||
      this.config.anchorControllerEnabled

    // TODO: Selectively register only the global singletons needed based on the config

    this.container = container
      // register repositories
      .provideFactory('requestRepository', RequestRepository.make)
      .provideClass('anchorRepository', AnchorRepository)
      .provideClass('transactionRepository', TransactionRepository)
      .provideClass('replicationRequestRepository', ReplicationRequestRepository)
      // register services
      .provideFactory('blockchainService', EthereumBlockchainService.make)
      .provideClass('eventProducerService', HTTPEventProducerService)
      .provideClass('ipfsQueueService', IpfsQueueService)
      .provideClass('ipfsService', IpfsService)
      .provideClass('anchorBatchQueueService', AnchorBatchSqsQueueService)
      .provideClass('validationQueueService', ValidationSqsQueueService)
      .provideFactory('merkleCarService', makeMerkleCarService)
      .provideFactory('witnessService', makeWitnessService)
      .provideClass('anchorService', AnchorService)
      .provideClass('markReadyScheduler', TaskSchedulerService)
      .provideClass('healthcheckService', HealthcheckService)
      .provideClass('requestPresentationService', RequestPresentationService)
      .provideClass('anchorRequestParamsParser', AnchorRequestParamsParser)
      .provideClass('continualAnchoringScheduler', TaskSchedulerService)
      .provideClass('requestService', RequestService)

    try {
      Metrics.start(
        this.config.metrics.collectorHost,
        'cas_' + this.mode,
        DEFAULT_TRACE_SAMPLE_RATIO,
        null, // no logging inside metrics
        false, // do not append total to counters automatically
        this.config.metrics.prometheusPort, // turn on the prometheus exporter if port is set
        this.config.metrics.exportIntervalMillis,
        this.config.metrics.exportTimeoutMillis
      )
      Metrics.count('HELLO', 1)
      logger.imp('Metrics exporter started')
      if (this.config.metrics.instanceIdentifier) {
        Metrics.setInstanceIdentifier(this.config.metrics.instanceIdentifier)
      }
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

    if (this.usesIpfs) {
      const ipfsService = this.container.resolve('ipfsService')
      await ipfsService.init()
    }

    const witnessService = this.container.resolve('witnessService')
    await witnessService.init()

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
      case AppMode.PUBSUB_RESPONDER:
        this._startPubsubResponder()
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

    const ipfsService = this.container.resolve('ipfsService')
    await ipfsService.stop()
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
      const success = await anchorService
        .anchorRequests({ signal: controller.signal })
        .catch((error: Error) => {
          if (!controller.signal.aborted) {
            logger.err(`Error when anchoring: ${error}`)
            Metrics.count(METRIC_NAMES.ERROR_WHEN_ANCHORING, 1, {
              message: error.message.substring(0, 50),
            })
          }
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

    const cbAfterNoOp = () => {
      logger.imp('No batches available. Continual anchoring is shutting down.')
      process.exit(0)
    }

    continualAnchoringScheduler.start(
      task,
      this.config.schedulerIntervalMS,
      this.config.schedulerStopAfterNoOp ? cbAfterNoOp : undefined
    )
  }

  private _startPubsubResponder(): void {
    // The ipfs service automatically subscribes to the provided pubsub topic
    // If we are in `pubsub-responder` mode we will handle Query messages
    // If we are not in `pubsub-responder` mode we will ignore all messages

    let shutdownInProgress: Promise<void> | undefined
    const shutdownSignalHandler = () => {
      if (!shutdownInProgress) {
        logger.imp('Gracefully shutting down pubsub responder mode')
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
  }
}
