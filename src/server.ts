import bodyParser from 'body-parser'
import { Server } from '@overnightjs/core'
import { auth } from './auth/index.js'
import { expressLoggers, logger, expressErrorLogger } from './logger/index.js'
import { Config } from 'node-config-ts'
import { multiprocess, type Multiprocess } from './ancillary/multiprocess.js'

const DEFAULT_SERVER_PORT = 8081

export class CeramicAnchorServer extends Server {
  private _server?: Multiprocess

  constructor(controllers: any[], config: Config) {
    super(true)

    this.app.set('trust proxy', true)
    this.app.use(bodyParser.raw({ inflate: true, type: 'application/vnd.ipld.car', limit: '1mb' }))
    this.app.use(bodyParser.json({ type: 'application/json' }))
    this.app.use(
      bodyParser.urlencoded({ extended: true, type: 'application/x-www-form-urlencoded' })
    )
    this.app.use(expressLoggers)
    if (config.requireAuth == true) {
      this.app.use(auth)
    }
    this.addControllers(controllers)

    // add error handling middleware here
    this.app.use(expressErrorLogger)
  }

  /**
   * Start the application
   * @param port - Server listening port
   */
  start(port: number = DEFAULT_SERVER_PORT): Promise<void> {
    const workers = process.env['JEST_WORKER_ID'] ? 0 : undefined
    return new Promise<void>((resolve, reject) => {
      this._server = multiprocess(
        () => {
          const server = this.app
            .listen(port, () => {
              logger.imp(`Server ready: Listening on port ${port}`)
              resolve()
            })
            .on('error', (err) => reject(err))

          return () => {
            server.close()
          }
        },
        {
          keepAlive: false,
          workers: workers,
        }
      )
    })
  }

  stop(): void {
    this._server?.stop()
  }
}
