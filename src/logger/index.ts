import { Request as ExpReq, Response as ExpRes } from 'express';
import morgan from 'morgan';
import { config } from 'node-config-ts';
import path from 'path';
import { DiagnosticsLogger, LogLevel, RotatingFileStream, ServiceLogger } from '@ceramicnetwork/logger';

const LOG_LEVEL = config.logger.level && LogLevel[config.logger.level] || LogLevel.important;
const LOG_TO_FILES = config.logger.logToFiles || false;
// LOG_PATH defaults to `ceramic-anchor-service/logs/`
let LOG_PATH = config.logger.filePath || path.join(path.resolve(__dirname, '../../'), 'logs/');
if (!LOG_PATH.endsWith('/')) {
  LOG_PATH = LOG_PATH + '/';
}

const ACCESS_FILE_PATH = path.join(LOG_PATH, 'access.log');
const EVENTS_FILE_PATH = path.join(LOG_PATH, 'events.log');
const METRICS_FILE_PATH = path.join(LOG_PATH, 'metrics.log');
const DIAGNOSTICS_FILE_PATH = path.join(LOG_PATH, 'diagnostics.log');

const ACCESS_LOG_FMT = 'ip=:remote-addr ts=:date[iso] method=:method original_url=:original-url base_url=:base-url path=:path http_version=:http-version req_header:req[header] status=:status content_length=:res[content-length] content_type=":res[content-type]" ref=:referrer user_agent=:user-agent elapsed_ms=:total-time[3]';

interface ServiceLog {
  type: string;
  [key: string]: any;
}


export const logger = new DiagnosticsLogger(LOG_LEVEL, LOG_TO_FILES, DIAGNOSTICS_FILE_PATH,);

export const expressLoggers = buildExpressMiddleware();
function buildExpressMiddleware() {
  morgan.token<ExpReq, ExpRes>('original-url', function (req, res): any {
    return req.originalUrl;
  });
  morgan.token<ExpReq, ExpRes>('base-url', function (req, res): any {
    return req.baseUrl;
  });
  morgan.token<ExpReq, ExpRes>('path', function (req, res): any {
    return req.path;
  });

  const middleware = [morgan('combined', { stream: logger })];

  if (LOG_TO_FILES) {
    const accessLogStream = new RotatingFileStream(ACCESS_FILE_PATH, true);
    middleware.push(morgan(ACCESS_LOG_FMT, { stream: accessLogStream }));
  }

  return middleware;
}

const anchorEventsLogger = new ServiceLogger('anchor', EVENTS_FILE_PATH, LOG_LEVEL, LOG_TO_FILES);
const dbEventsLogger = new ServiceLogger('db', EVENTS_FILE_PATH, LOG_LEVEL, LOG_TO_FILES);
const ethereumEventsLogger = new ServiceLogger('ethereum', EVENTS_FILE_PATH, LOG_LEVEL, LOG_TO_FILES);

export const logEvent = {
  anchor: (log: ServiceLog): void => anchorEventsLogger.log(log),
  db: (log: ServiceLog): void => dbEventsLogger.log(log),
  ethereum: (log: ServiceLog): void => ethereumEventsLogger.log(log)
}

const anchorMetricsLogger = new ServiceLogger('anchor', METRICS_FILE_PATH, LOG_LEVEL, LOG_TO_FILES);
const ethereumMetricsLogger = new ServiceLogger('ethereum', METRICS_FILE_PATH, LOG_LEVEL, LOG_TO_FILES);

export const logMetric = {
  anchor: (log: ServiceLog): void => anchorMetricsLogger.log(log),
  ethereum: (log: ServiceLog): void => ethereumMetricsLogger.log(log)
}
