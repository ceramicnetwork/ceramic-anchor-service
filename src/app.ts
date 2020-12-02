import 'reflect-metadata';
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

import { LoggerModes } from '@overnightjs/logger';

// Set env variables
process.env.OVERNIGHT_LOGGER_MODE = LoggerModes.Console;
process.env.OVERNIGHT_LOGGER_RM_TIMESTAMP = 'false';

import { config } from 'node-config-ts';
import { Logger as logger } from '@overnightjs/logger';
import { container } from "tsyringe";

import CeramicAnchorServer from './server';
import { createConnection } from 'typeorm';
import { IpfsServiceImpl} from "./services/ipfs-service";
import AnchorService from "./services/anchor-service";
import SchedulerService from "./services/scheduler-service";
import BlockchainService from "./services/blockchain/blockchain-service";

import { initializeTransactionalContext } from 'typeorm-transactional-cls-hooked';
import AnchorRepository from "./repositories/anchor-repository";
import RequestRepository from "./repositories/request-repository";
import CeramicService from "./services/ceramic-service";
import RequestService from "./services/request-service";
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
    CeramicAnchorApp._patchConfigTypes();

    // register repositories
    container.registerSingleton('anchorRepository', AnchorRepository);
    container.registerSingleton("requestRepository", RequestRepository);

    // register services
    container.registerSingleton("blockchainService", EthereumBlockchainService);
    container.registerSingleton("anchorService", AnchorService);
    container.registerSingleton("ceramicService", CeramicService);
    container.registerSingleton("ipfsService", IpfsServiceImpl);
    container.registerSingleton("requestService", RequestService);
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
   * Patches config variables.
   *
   * Note: sometimes strings are passed as booleans.
   * @private
   */
  static _patchConfigTypes(): void {
    const traverse = function(o) {
      for (const prop in Object.keys(o)) {
        if (o[prop] === 'true' || o[prop] === 'false') {
          o[prop] = o[prop] === 'true'
        }
        if (o[prop] !== null && typeof o[prop] === "object") {
          traverse(o[prop]);
        }
      }
    };
    traverse(config);
  }

  /**
   * Start application
   */
  public async start(): Promise<void> {
    const blockchainService: BlockchainService = container.resolve<BlockchainService>('blockchainService');
    await blockchainService.connect();

    const mode = config.mode.trim().toLowerCase();
    switch (mode) {
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
        logger.Err(`Unknown application mode ${mode}`, true);
        process.exit(1);
      }
    }
    logger.Imp(`Ceramic Anchor Service started in ${mode} mode`);
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
   * Starts application in anchoring mode (Anchor without the Server)
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
    createConnection().then(async () => await fn()).catch((e) => {
      logger.Err(`Failed to start Ceramic Anchor Service. Error ${e.message}`);
      process.exit(1)
    });
  }

  /**
   * Execute a single anchor process
   */
  private async _executeAnchor(): Promise<void> {
    this.startWithConnectionHandling(async () => {
      const anchorService: AnchorService = container.resolve<AnchorService>('anchorService');
      await anchorService.anchorRequests();
    });
  }
}

const app = new CeramicAnchorApp();
app.start()
  .then(() => logger.Imp("Ceramic Anchor Service started..."))
  .catch((e) => {
    logger.Err(e, true);
    process.exit(1);
  });
