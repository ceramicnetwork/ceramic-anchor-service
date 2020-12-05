import { Logger, LoggerModes } from '@overnightjs/logger'
import morgan from 'morgan'
import { config } from 'node-config-ts'
import * as rfs from 'rotating-file-stream'

enum LogLevel {
  debug,
  important,
  warn
}

const logLevelMapping = {
  'debug': LogLevel.debug,
  'important': LogLevel.important,
  'warn': LogLevel.warn
}

const LOG_LEVEL = logLevelMapping[config.logger.level] || LogLevel.important
const LOG_TO_FILES = config.logger.logToFiles || false
const LOG_PATH = config.logger.filePath || '/usr/local/var/log/cas'

/**
 * Handles logging
 */
export class CASLogger {
  public readonly logLevel: LogLevel
  public readonly expressLoggers: any[]
  private consoleLogger: Logger
  private includeStackTrace: boolean

  constructor(logLevel: LogLevel) {
    this.consoleLogger = new Logger(LoggerModes.Console, '', true)
    this.logLevel = logLevel
    this.includeStackTrace = this.logLevel == LogLevel.debug ? true : false
  }

  // Used for stream interface
  public write(content: string | object): void {
    this.debug(content)
  }

  public debug(content: string | object): void {
    if (this.logLevel > LogLevel.debug) {
        return
    }
    this.consoleLogger.info(content, this.includeStackTrace)
  }

  public imp(content: string | object): void {
    if (this.logLevel > LogLevel.important) {
        return
    }
    this.consoleLogger.imp(content, this.includeStackTrace)
  }

  public warn(content: string | object): void {
    this.consoleLogger.warn(content, this.includeStackTrace)
  }

  public err(content: string | object): void {
    this.consoleLogger.err(content, this.includeStackTrace)
  }
}

export const accessLogStream = rfs.createStream(`${LOG_PATH}/access.log`, {
  size: "10M", // rotate every 10 MegaBytes written
  interval: "1d", // rotate daily
  compress: "gzip" // compress rotated files
})

export const logger = new CASLogger(LOG_LEVEL);

function buildExpressMiddleware() {
  const middleware = [morgan('combined', { stream: logger })]
  if (LOG_TO_FILES) {
    middleware.push(morgan('combined', { stream: accessLogStream }))
  }
  return middleware
}

export const expressLoggers = buildExpressMiddleware()
