import 'reflect-metadata';
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

import { config } from 'node-config-ts';
import { container, instanceCachingFactory } from 'tsyringe';

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

initializeTransactionalContext();

/**
 * Ceramic Anchor Service application
 */
export default class CeramicAnchorApp {
  constructor() {
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
   * Start application
   */
  public async start(): Promise<void> {
    const blockchainService: BlockchainService = container.resolve<BlockchainService>('blockchainService');
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
    const ipfsService: IpfsServiceImpl = container.resolve<IpfsServiceImpl>('ipfsService');
    await ipfsService.init();

    const schedulerService: SchedulerService = container.resolve<SchedulerService>('schedulerService');
    schedulerService.start();
    await this._startServer();
  }

  /**
   * Start application in Server mode, which will accept and store anchor requests in a database, but not actually submit any anchors to the blockchain.
   * @private
   */
  private async _startServer(): Promise<void> {
    this.startWithConnectionHandling(async () => {
      const server = new CeramicAnchorServer(container);
      await server.start(config.port);
    });
  }

  /**
   * Starts application in anchoring mode, without the API server. This will cause the process to startup, read the database for pending anchors requests, and perform a single anchor on chain before shutting down.
   * @private
   */
  private async _startAnchor(): Promise<void> {
    const ipfsService: IpfsServiceImpl = container.resolve<IpfsServiceImpl>('ipfsService');
    await ipfsService.init();

    await this._executeAnchor();
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

  /**
   * Execute a single anchor process
   */
  private async _executeAnchor(): Promise<void> {
    await this.startWithConnectionHandling(async () => {
      const anchorService: AnchorService = container.resolve<AnchorService>('anchorService');
      await anchorService.anchorRequests();
    });
  }
}

const app = new CeramicAnchorApp();
app.start()
  .catch((e) => {
    logger.err(e);
    process.exit(1);
  });
