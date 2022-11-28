import bodyParser from 'body-parser'
import { Server } from '@overnightjs/core'
import { expressLoggers, logger } from './logger/index.js'

import * as http from 'http'

const DEFAULT_SERVER_PORT = 8081

export class CeramicAnchorServer extends Server {
  private _server: http.Server

  constructor(controllers: any[]) {
    super(true)

    this.app.set('trust proxy', true)
    this.app.use(bodyParser.json())
    this.app.use(bodyParser.urlencoded({ extended: true }))
    this.app.use(expressLoggers)
    this.addControllers(controllers)
  }

  /**
   * Start the application
   * @param port - Server listening port
   */
  start(port: number = DEFAULT_SERVER_PORT): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._server = this.app
        .listen(port, () => {
          logger.imp(`Server ready: Listening on port ${port}`)
          resolve()
        })
        .on('error', (err) => reject(err))
    })
  }

  stop(): void {
    this._server.close()
  }
}
