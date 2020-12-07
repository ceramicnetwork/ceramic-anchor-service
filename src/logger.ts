import { Logger, LoggerModes } from '@overnightjs/logger'
import { Writable } from 'stream'
import * as logfmt from 'logfmt'
import morgan from 'morgan'
import { config } from 'node-config-ts'
import * as rfs from 'rotating-file-stream'

enum LogLevel {
  debug = 1,
  important = 2,
  warn = 3
}

const logLevelMapping = {
  'debug': LogLevel.debug,
  'important': LogLevel.important,
  'warn': LogLevel.warn
}

const LOG_LEVEL = config.logger.level && logLevelMapping[config.logger.level] || LogLevel.important
const LOG_TO_FILES = config.logger.logToFiles || false
const LOG_PATH = config.logger.filePath || '/usr/local/var/log/cas'
const METRICS_FILE_PATH = LOG_PATH + '/metrics.log'
const EVENTS_FILE_PATH = LOG_PATH + '/events.log'
const REMOVE_TIMESTAMP = true

const LOG_FMT = '[:date[web]] ip=:remote-addr ts=:date[iso] method=:method path=:url http_version=:http-version req_header:req[header] status=:status content_length=:res[content-length] content_type=":res[content-type]" ref=:referrer user_agent=:user-agent elapsed_ms=:total-time[3]'

/**
 * Handles logging
 */
class CASLogger {
  public readonly logLevel: LogLevel
  private consoleLogger: Logger
  private includeStackTrace: boolean

  constructor(logLevel: LogLevel) {
    this.consoleLogger = new Logger(LoggerModes.Console, '', REMOVE_TIMESTAMP)
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

class StreamLogger {
  public blocked: boolean
  private path: string
  private stream: Writable

  constructor(path: string, stream: Writable) {
    this.path = path
    this.stream = stream
  }

  protected writeStream(message: string): void {
    if (this.blocked) {
      console.warn(`Stream busy for ${this.path}. Some logs may be dropped.`)
      return
    }
    this.blocked = true

    this.stream.on('error', (err) => {
      console.warn(err)
      return
    })
    this.stream.on('drain', () => {
      this.blocked = false
      return
    })
    this.stream.on('finish', () => {
      this.blocked = false
      return
    })
    this.blocked = !this.stream.write(message + '\n', () => {
      this.stream.end()
      return
    })
  }
}

interface ServiceLog {
  type: string
  [key: string]: any
}

class ServiceLogger extends StreamLogger {
  public service: string

  constructor(service: string, path: string, stream: Writable) {
    super(path, stream)
    this.service = service
  }

  public log(content: ServiceLog, logToConsole?: boolean): void {
    const message = `[${Date.now()}] service=${this.service} ${ServiceLogger.format(content)}`
    this.writeStream(message)
    if (LOG_LEVEL == LogLevel.debug) {
      console.log(message)
    } else if (logToConsole) {
      console.log(message)
    }
  }

  public static format(content: ServiceLog): string {
    return logfmt.stringify(content)
  }
}

export const logger = new CASLogger(LOG_LEVEL)

export const expressLoggers = buildExpressMiddleware()
function buildExpressMiddleware() {
  const middleware = [morgan('combined', { stream: logger })]
  if (LOG_TO_FILES) {
    const accessLogStream = rfs.createStream(`${LOG_PATH}/access.log`, {
      size: '10M',
      interval: '1d',
      compress: 'gzip'
    })
    middleware.push(morgan(LOG_FMT, { stream: accessLogStream }))
  }
  return middleware
}

const eventsStream = rfs.createStream(EVENTS_FILE_PATH, {
    size: '10M',
    interval: '1d',
    compress: 'gzip'
  })
const metricsStream = rfs.createStream(METRICS_FILE_PATH, {
    size: '10M',
    interval: '1d',
    compress: 'gzip'
  })


const dbEventsLogger = new ServiceLogger('db', EVENTS_FILE_PATH, eventsStream)
const ethereumEventsLogger = new ServiceLogger('ethereum', EVENTS_FILE_PATH, eventsStream)

const anchorMetricsLogger = new ServiceLogger('anchor', METRICS_FILE_PATH, metricsStream)
const ethereumMetricsLogger = new ServiceLogger('ethereum', METRICS_FILE_PATH, metricsStream)

export const logEvent = {
  db: dbEventsLogger.log,
  ethereum: ethereumEventsLogger.log
}

export const logMetric = {
  anchor: anchorMetricsLogger.log,
  ethereum: ethereumMetricsLogger.log
}
