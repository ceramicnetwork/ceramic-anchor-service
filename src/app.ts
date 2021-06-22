import 'reflect-metadata';
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageJson = require('../package.json')

import { config } from 'node-config-ts';
import { instanceCachingFactory, DependencyContainer } from 'tsyringe';

import { logger } from "./logger";
import CeramicAnchorServer from './server';
import { createConnection } from 'typeorm';
import { IpfsServiceImpl } from "./services/ipfs-service";
import AnchorService from "./services/anchor-service";
import SchedulerService from "./services/scheduler-service";
import BlockchainService from "./services/blockchain/blockchain-service";

import { initializeTransactionalContext } from 'typeorm-transactional-cls-hooked';
import AnchorRepository from "./repositories/anchor-repository";
import RequestRepository from "./repositories/request-repository";
import CeramicServiceImpl from "./services/ceramic-service";
import HealthcheckController from "./controllers/healthcheck-controller";
import AnchorController from "./controllers/anchor-controller";
import RequestController from "./controllers/request-controller";
import ServiceInfoController from "./controllers/service-info-controller";
import EthereumBlockchainService from "./services/blockchain/ethereum/ethereum-blockchain-service";

import cloneDeep from 'lodash.clonedeep'

initializeTransactionalContext();

/**
 * Ceramic Anchor Service application
 */
export default class CeramicAnchorApp {

  constructor(private readonly container: DependencyContainer) {
    CeramicAnchorApp._normalizeConfig();

    // TODO: Selectively register only the global singletons needed based on the config

    // register repositories
    container.registerSingleton('anchorRepository', AnchorRepository);
    container.registerSingleton("requestRepository", RequestRepository);

    // register services
    container.register("blockchainService", {
      useFactory: instanceCachingFactory<EthereumBlockchainService>(c => EthereumBlockchainService.make())
    });
    container.registerSingleton("anchorService", AnchorService);
    if (config.mode == "bundled" || config.mode == "anchor" || config.anchorControllerEnabled) {
      // Only register the ceramicService if we might ever need to perform an anchor
      container.registerSingleton("ceramicService", CeramicServiceImpl);
    }
    container.registerSingleton("ipfsService", IpfsServiceImpl);
    container.registerSingleton("schedulerService", SchedulerService);

    // register controllers
    container.registerSingleton("healthcheckController", HealthcheckController);
    container.registerSingleton("requestController", RequestController);
    container.registerSingleton("serviceInfoController", ServiceInfoController);

    if (config.anchorControllerEnabled) {
      container.registerSingleton("anchorController", AnchorController);
    }
  }

  /**
   * Handles normalizing the arguments passed via the config, for example turning string
   * representations of booleans and numbers into the proper types
   */
  static _normalizeConfig() {
    config.mode = config.mode.trim().toLowerCase();
    if (typeof config.merkleDepthLimit == 'string') {
      config.merkleDepthLimit = parseInt(config.merkleDepthLimit)
    }

    const replaceBools = function(o) {
      for (const prop of Object.keys(o)) {
        if (o[prop] === 'true' || o[prop] === 'false') {
          o[prop] = o[prop] === 'true'
        }
        if (o[prop] !== null && typeof o[prop] === "object") {
          replaceBools(o[prop]);
        }
      }
    };
    replaceBools(config);
  }

  /**
   * Returns a copy of the config with any sensitive information removed so it is safe to log
   * @param config
   */
  static _cleanupConfigForLogging(config) : Record<string, any> {
    const configCopy = cloneDeep(config)
    delete configCopy?.blockchain?.connectors?.ethereum?.account?.privateKey
    return configCopy
  }

  /**
   * Start application
   */
  public async start(): Promise<void> {
    const configLogString = JSON.stringify(CeramicAnchorApp._cleanupConfigForLogging(config), null, 2)
    logger.imp(`Starting Ceramic Anchor Service at version ${packageJson.version} with config:\n${configLogString}`)

    const blockchainService: BlockchainService = this.container.resolve<BlockchainService>('blockchainService');
    await blockchainService.connect();

    switch (config.mode) {
      case 'server': {
        await this._startServer();
        break;
      }
      case 'anchor': {
        await this._startAnchor();
        break;
      }
      case 'bundled': {
        await this._startBundled();
        break;
      }
      default: {
        logger.err(`Unknown application mode ${config.mode}`);
        process.exit(1);
      }
    }
    logger.imp(`Ceramic Anchor Service initiated ${config.mode} mode`);
  }

  /**
   * Starts bundled application (API + periodic anchoring)
   * @private
   */
  private async _startBundled(): Promise<void> {
    const ipfsService: IpfsServiceImpl = this.container.resolve<IpfsServiceImpl>('ipfsService');
    await ipfsService.init();

    const schedulerService: SchedulerService = this.container.resolve<SchedulerService>('schedulerService');
    schedulerService.start();
    await this._startServer();
  }

  /**
   * Start application in Server mode, which will accept and store anchor requests in a database, but not actually submit any anchors to the blockchain.
   * @private
   */
  private async _startServer(): Promise<void> {
    this.startWithConnectionHandling(async () => {
      const server = new CeramicAnchorServer(this.container);
      await server.start(config.port);
    });
  }

  /**
   * Starts application in anchoring mode, without the API server. This will cause the process to startup, read the database for pending anchors requests, and perform a single anchor on chain before shutting down.
   * @private
   */
  private async _startAnchor(): Promise<void> {
    const ipfsService: IpfsServiceImpl = this.container.resolve<IpfsServiceImpl>('ipfsService');
    await ipfsService.init();

    this.startWithConnectionHandling(async () => {
      const anchorService: AnchorService = this.container.resolve<AnchorService>('anchorService');
      await anchorService.anchorRequests();
      process.exit();
    }).catch((error) => {
      logger.err(`Error when anchoring: ${error}`);
      logger.err('Exiting');
      process.exit(1);
    });
  }

  /**
   * Wrap execution function with TypeOrm connection handling
   * @param fn - Function to be executed
   */
  private async startWithConnectionHandling(fn: Function): Promise<void> {
    // create connection with database
    // note that it's not active database connection
    // typeorm creates connection pools and uses them for requests
    try {
      logger.imp('Connecting to database...');
      const connection = await createConnection();
      logger.imp(`Connected to database: ${connection.name}`);
    } catch (e) {
      logger.err(`Database connection failed. Error: ${e.message}`);
      process.exit(1);
    }
    await fn();
  }
}