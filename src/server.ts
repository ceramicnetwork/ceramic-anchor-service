import * as bodyParser from 'body-parser'
import { Server } from '@overnightjs/core'

import { Config } from 'node-config-ts'

import { AnchorController } from './controllers/anchor-controller.js'
import { RequestController } from './controllers/request-controller.js'
import { ServiceInfoController } from './controllers/service-info-controller.js'
import { HealthcheckController } from './controllers/healthcheck-controller.js'

import { expressLoggers, logger } from './logger/index.js'

import DependencyContainer from 'tsyringe/dist/typings/types/dependency-container'
import * as http from 'http'

const DEFAULT_SERVER_PORT = 8081

export class CeramicAnchorServer extends Server {
  private _server: http.Server

  constructor(private container: DependencyContainer) {
    super(true)

    this.app.set('trust proxy', true)
    this.app.use(bodyParser.json())
    this.app.use(bodyParser.urlencoded({ extended: true }))
    this.app.use(expressLoggers)
  }

  /**
   * Start the application
   * @param port - Server listening port
   */
  public async start(port?: number): Promise<void> {
    const config = this.container.resolve<Config>('config')
    const requestController = this.container.resolve<RequestController>('requestController')
    const serviceInfoController =
      this.container.resolve<ServiceInfoController>('serviceInfoController')
    const healthcheckController =
      this.container.resolve<HealthcheckController>('healthcheckController')

    const controllers: Array<any> = [
      requestController,
      serviceInfoController,
      healthcheckController,
    ]
    if (config.anchorControllerEnabled) {
      const anchorController = this.container.resolve<AnchorController>('anchorController')
      controllers.push(anchorController)
    }

    this.addControllers(controllers)

    port = port || DEFAULT_SERVER_PORT
    this._server = this.app.listen(port, () => {
      logger.imp(`Server ready: Listening on port ${port}`)
    })
  }

  public stop(): void {
    this._server.close()
  }
}
