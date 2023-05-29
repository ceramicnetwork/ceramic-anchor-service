import { Request as ExpReq, Response as ExpRes, NextFunction as ExpNext } from 'express'
import morgan from 'morgan'
import { config } from 'node-config-ts'
import path from 'path'
import { LoggerProvider, LogLevel } from '@ceramicnetwork/common'
import { RotatingFileStream } from '@ceramicnetwork/logger'

const LOG_LEVEL =
  (config.logger.level && LogLevel[config.logger.level as unknown as LogLevel]) ||
  LogLevel.important
const LOG_TO_FILES = config.logger.logToFiles || false
// LOG_PATH defaults to `ceramic-anchor-service/logs/`
let LOG_PATH = config.logger.filePath || path.join(path.resolve(import.meta.url, '../../'), 'logs/')
if (!LOG_PATH.endsWith('/')) {
  LOG_PATH = LOG_PATH + '/'
}

const EVENTS_LOG_NAME = 'events'
const METRICS_LOG_NAME = 'metrics'

const ACCESS_LOG_FMT =
  'ip=:remote-addr source_ip=:source-ip ts=:date[iso] method=:method original_url=:original-url base_url=:base-url path=:path http_version=:http-version req_header=:req[header] status=:status content_length=:res[content-length] content_type=":res[content-type]" ref=:referrer did=":did" user_agent=":user-agent" elapsed_ms=:total-time[3]'

interface ServiceLog {
  type: string
  [key: string]: any
}

const loggerProvider = new LoggerProvider(
  {
    logDirectory: LOG_PATH,
    logToFiles: LOG_TO_FILES,
    logLevel: LOG_LEVEL as LogLevel,
  },
  (logPath: string) => {
    return new RotatingFileStream(logPath, true)
  }
)
export const logger = loggerProvider.getDiagnosticsLogger()

export const expressLoggers = buildExpressMiddleware()
function buildExpressMiddleware() {
  morgan.token<ExpReq, ExpRes>('original-url', function (req): any {
    return req.originalUrl
  })
  morgan.token<ExpReq, ExpRes>('base-url', function (req): any {
    return req.baseUrl
  })
  morgan.token<ExpReq, ExpRes>('path', function (req): any {
    return req.path
  })
  morgan.token<ExpReq, ExpRes>('source-ip', function (req): any {
    return req.get('sourceIp')
  })
  morgan.token<ExpReq, ExpRes>('did', function (req): any {
    return req.get('did')
  })

  const logger = loggerProvider.makeServiceLogger('http-access')
  return morgan(ACCESS_LOG_FMT, { stream: logger })
}

const anchorEventsLogger = loggerProvider.makeServiceLogger('anchor', EVENTS_LOG_NAME)
const dbEventsLogger = loggerProvider.makeServiceLogger('db', EVENTS_LOG_NAME)
const ethereumEventsLogger = loggerProvider.makeServiceLogger('ethereum', EVENTS_LOG_NAME)

export const logEvent = {
  anchor: (log: ServiceLog): void => anchorEventsLogger.log(log),
  db: (log: ServiceLog): void => dbEventsLogger.log(log),
  ethereum: (log: ServiceLog): void => ethereumEventsLogger.log(log),
}

const anchorMetricsLogger = loggerProvider.makeServiceLogger('anchor', METRICS_LOG_NAME)
const ethereumMetricsLogger = loggerProvider.makeServiceLogger('ethereum', METRICS_LOG_NAME)

export const logMetric = {
  anchor: (log: ServiceLog): void => anchorMetricsLogger.log(log),
  ethereum: (log: ServiceLog): void => ethereumMetricsLogger.log(log),
}

interface ErrorData extends ServiceLog {
  type: string;
  message: string;
  stack: string;
  status: number;
  originalUrl: string;
  baseUrl: string;
  path: string;
  sourceIp: string;
  did: string;
}

export function expressErrorLogger(err: Error, req: ExpReq, res: ExpRes, next: ExpNext): void {
  const logger = loggerProvider.makeServiceLogger('http-error');
  const errorData: ErrorData = {
    type: 'error',
    message: err.message,
    stack: err.stack || '',
    status: (err as any).status || 500,
    originalUrl: req.originalUrl,
    baseUrl: req.baseUrl,
    path: req.path,
    sourceIp: req.get('sourceIp') || '',
    did: req.get('did') || '',
  };

  logger.log(errorData);
  next(err); 
}





