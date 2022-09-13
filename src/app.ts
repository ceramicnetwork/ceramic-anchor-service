import 'reflect-metadata'
import 'dotenv/config'

import { Config } from 'node-config-ts'
import { instanceCachingFactory, DependencyContainer } from 'tsyringe'

import { logger } from './logger/index.js'
import { CeramicAnchorServer } from './server.js'
import type { Connection } from 'typeorm'
import { IpfsServiceImpl } from './services/ipfs-service.js'
import { AnchorService } from './services/anchor-service.js'
import { SchedulerService } from './services/scheduler-service.js'
import { BlockchainService } from './services/blockchain/blockchain-service.js'
import { HTTPEventProducerService } from './services/event-producer/http/http-event-producer-service.js'

import { AnchorRepository } from './repositories/anchor-repository.js'
import { RequestRepository } from './repositories/request-repository.js'
import { CeramicServiceImpl } from './services/ceramic-service.js'
import { HealthcheckController } from './controllers/healthcheck-controller.js'
import { AnchorController } from './controllers/anchor-controller.js'
import { RequestController } from './controllers/request-controller.js'
import { ServiceInfoController } from './controllers/service-info-controller.js'
import { EthereumBlockchainService } from './services/blockchain/ethereum/ethereum-blockchain-service.js'

import cloneDeep from 'lodash.clonedeep'
import { ServiceMetrics as Metrics } from './service-metrics.js'

const version = process.env.npm_package_version
/**
 * Ceramic Anchor Service application
 */
export class CeramicAnchorApp {
  private _schedulerService: SchedulerService
  private _server: CeramicAnchorServer

  constructor(
    private readonly container: DependencyContainer,
    private readonly config: Config,
    dbConnection: Connection
  ) {
    CeramicAnchorApp._normalizeConfig(config)

    // TODO: Selectively register only the global singletons needed based on the config

    // register config
    container.register('config', {
      useFactory: instanceCachingFactory<Config>((c) => config),
    })

    // register database connection
    container.register('dbConnection', {
      useFactory: instanceCachingFactory<Connection>((c) => dbConnection),
    })

    // register repositories
    container.registerSingleton('anchorRepository', AnchorRepository)
    container.registerSingleton('requestRepository', RequestRepository)

    // register services
    container.register('blockchainService', {
      useFactory: instanceCachingFactory<EthereumBlockchainService>((c) =>
        EthereumBlockchainService.make(config)
      ),
    })
    container.registerSingleton('eventProducerService', HTTPEventProducerService)
    container.registerSingleton('anchorService', AnchorService)
    container.registerSingleton('ceramicService', CeramicServiceImpl)
    container.registerSingleton('ipfsService', IpfsServiceImpl)
    container.registerSingleton('schedulerService', SchedulerService)

    // register controllers
    container.registerSingleton('healthcheckController', HealthcheckController)
    container.registerSingleton('requestController', RequestController)
    container.registerSingleton('serviceInfoController', ServiceInfoController)

    if (config.anchorControllerEnabled) {
      container.registerSingleton('anchorController', AnchorController)
    }

    try {
        Metrics.start(config.metrics.collectorHost, 'cas-' + config.mode)
        Metrics.count('HELLO', 1) 
        logger.imp("Metrics exporter started")
    } catch (e) {
        logger.err(e)
        // start anchor service even if metrics threw an error
    }
  }

  /**
   * Handles normalizing the arguments passed via the config, for example turning string
   * representations of booleans and numbers into the proper types
   */
  static _normalizeConfig(config: Config): void {
    config.mode = config.mode.trim().toLowerCase()
    if (typeof config.merkleDepthLimit == 'string') {
      config.merkleDepthLimit = parseInt(config.merkleDepthLimit)
    }

    const replaceBools = function (o) {
      for (const prop of Object.keys(o)) {
        if (o[prop] === 'true' || o[prop] === 'false') {
          o[prop] = o[prop] === 'true'
        }
        if (o[prop] !== null && typeof o[prop] === 'object') {
          replaceBools(o[prop])
        }
      }
    }
    replaceBools(config)
  }

  /**
   * Returns a copy of the config with any sensitive information removed so it is safe to log
   * @param config
   */
  static _cleanupConfigForLogging(config): Record<string, any> {
    const configCopy = cloneDeep(config)
    delete configCopy?.blockchain?.connectors?.ethereum?.account?.privateKey
    delete configCopy?.anchorLauncherUrl
    return configCopy
  }

  /**
   * Returns true when we're running in a config that may do an anchor.
   * @private
   */
  private _anchorsSupported(): Boolean {
    return (
      this.config.mode == 'anchor' ||
      this.config.mode == 'bundled' ||
      this.config.anchorControllerEnabled
    )
  }

  public async anchor(triggeredByAnchorEvent = false): Promise<void> {
    const anchorService: AnchorService = this.container.resolve<AnchorService>('anchorService')
    return anchorService.anchorRequests(triggeredByAnchorEvent)
  }

  /**
   * Start application
   */
  public async start(): Promise<void> {
    const configLogString = JSON.stringify(
      CeramicAnchorApp._cleanupConfigForLogging(this.config),
      null,
      2
    )
    logger.imp(
      `Starting Ceramic Anchor Service at version ${version} with config:\n${configLogString}`
    )

    const blockchainService: BlockchainService =
      this.container.resolve<BlockchainService>('blockchainService')
    await blockchainService.connect()

    if (this._anchorsSupported()) {
      const ipfsService: IpfsServiceImpl = this.container.resolve<IpfsServiceImpl>('ipfsService')
      await ipfsService.init()
    }

    switch (this.config.mode) {
      case 'server': {
        await this._startServer()
        break
      }
      case 'anchor': {
        await this._startAnchorAndGarbageCollection()
        break
      }
      case 'bundled': {
        await this._startBundled()
        break
      }
      case 'scheduler': {
        await this._startScheduler()
        break
      }

      default: {
        logger.err(`Unknown application mode ${this.config.mode}`)
        process.exit(1)
      }
    }
    logger.imp(`Ceramic Anchor Service initiated ${this.config.mode} mode`)
  }

  public stop(): void {
    if (this._schedulerService) {
      this._schedulerService.stop()
    }
    if (this._server) {
      this._server.stop()
    }
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
    this._schedulerService = this.container.resolve<SchedulerService>('schedulerService')
    const anchorService: AnchorService = this.container.resolve<AnchorService>('anchorService')
    this._schedulerService.start(async () => await anchorService.emitAnchorEventIfReady())
  }

  /**
   * Starts bundled application (API + periodic anchoring)
   * @private
   */
  private async _startBundled(): Promise<void> {
    this._schedulerService = this.container.resolve<SchedulerService>('schedulerService')
    const anchorService: AnchorService = this.container.resolve<AnchorService>('anchorService')
    this._schedulerService.start(async () => {
      await anchorService.anchorRequests()
    })
    await this._startServer()
  }

  /**
   * Start application in Server mode, which will accept and store anchor requests in a database, but not actually submit any anchors to the blockchain.
   * @private
   */
  private async _startServer(): Promise<void> {
    this._server = new CeramicAnchorServer(this.container)
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
    const anchorService: AnchorService = this.container.resolve<AnchorService>('anchorService')
    await anchorService.anchorRequests().catch((error) => {
      logger.err(`Error when anchoring: ${error}`)
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
}
