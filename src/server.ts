import * as bodyParser from 'body-parser';
import { Server } from '@overnightjs/core';
import { Logger as logger } from '@overnightjs/logger';

import DependencyContainer from "tsyringe/dist/typings/types/dependency-container";
import InternalController from "./controllers/internal-controller";
import RequestController from "./controllers/request-controller";
import ServiceInfoController from "./controllers/service-info-controller";
import HealthcheckController from "./controllers/healthcheck-controller";

const DEFAULT_SERVER_PORT = 8081;

export default class CeramicAnchorServer extends Server {

  constructor(private container: DependencyContainer) {
    super(true);

    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));
  }

  /**
   * Start the application
   * @param port - Server listening port
   */
  public async start(port?: number): Promise<void> {
    const internalController = this.container.resolve<InternalController>('internalController');
    const requestController = this.container.resolve<RequestController>('requestController');
    const serviceInfoController = this.container.resolve<ServiceInfoController>('serviceInfoController');
    const healthcheckController = this.container.resolve<HealthcheckController>('healthcheckController');

    this.addControllers([internalController, requestController, serviceInfoController, healthcheckController]);

    port = port || DEFAULT_SERVER_PORT;
    this.app.listen(port, () => {
      logger.Imp(`Ceramic anchor service started on port ${port}`);
    });
  }
}
