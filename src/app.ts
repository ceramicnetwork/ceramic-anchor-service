import 'reflect-metadata'
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config()

// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageJson = require('../package.json')

import { Config } from 'node-config-ts'
import { instanceCachingFactory, DependencyContainer } from 'tsyringe'

import { logger } from './logger'
import CeramicAnchorServer from './server'
import { Connection } from 'typeorm'
import { IpfsServiceImpl } from './services/ipfs-service'
import AnchorService from './services/anchor-service'
import SchedulerService from './services/scheduler-service'
import BlockchainService from './services/blockchain/blockchain-service'

import AnchorRepository from './repositories/anchor-repository'
import RequestRepository from './repositories/request-repository'
import CeramicServiceImpl from './services/ceramic-service'
import HealthcheckController from './controllers/healthcheck-controller'
import AnchorController from './controllers/anchor-controller'
import RequestController from './controllers/request-controller'
import ServiceInfoController from './controllers/service-info-controller'
import EthereumBlockchainService from './services/blockchain/ethereum/ethereum-blockchain-service'

import cloneDeep from 'lodash.clonedeep'

/**
 * Ceramic Anchor Service application
 */
export default class CeramicAnchorApp {
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
    container.registerSingleton('anchorService', AnchorService)
    if (this._anchorsSupported()) {
      // Only register the ceramicService if we might ever need to perform an anchor
      container.registerSingleton('ceramicService', CeramicServiceImpl)
    }
    container.registerSingleton('ipfsService', IpfsServiceImpl)
    container.registerSingleton('schedulerService', SchedulerService)

    // register controllers
    container.registerSingleton('healthcheckController', HealthcheckController)
    container.registerSingleton('requestController', RequestController)
    container.registerSingleton('serviceInfoController', ServiceInfoController)

    if (config.anchorControllerEnabled) {
      container.registerSingleton('anchorController', AnchorController)
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

  public async anchor(): Promise<void> {
    const anchorService: AnchorService = this.container.resolve<AnchorService>('anchorService')
    return anchorService.anchorRequests()
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
      `Starting Ceramic Anchor Service at version ${packageJson.version} with config:\n${configLogString}`
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
   * Starts bundled application (API + periodic anchoring)
   * @private
   */
  private async _startBundled(): Promise<void> {
    this._schedulerService = this.container.resolve<SchedulerService>('schedulerService')
    this._schedulerService.start()
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
