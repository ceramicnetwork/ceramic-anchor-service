import { Logger, LoggerModes } from '@overnightjs/logger';
import * as logfmt from 'logfmt';
import morgan from 'morgan';
import { config } from 'node-config-ts';
import path from 'path';
import util from 'util';
import { RotatingFileStream } from './stream-helpers';

enum LogStyle {
  info = 'info',
  imp = 'imp',
  warn = 'warn',
  err = 'err'
}

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

const LOG_LEVEL = config.logger.level && logLevelMapping[config.logger.level] || LogLevel.important;
const LOG_TO_FILES = config.logger.logToFiles || false;
// LOG_PATH defaults to `ceramic-anchor-service/logs/`
let LOG_PATH = config.logger.filePath || path.join(path.resolve(__dirname, '../../'), 'logs/');
if (!LOG_PATH.endsWith('/')) {
  LOG_PATH = LOG_PATH + '/';
}

const ACCESS_FILE_PATH = path.join(LOG_PATH, 'access.log');
const EVENTS_FILE_PATH = path.join(LOG_PATH, 'events.log');
const METRICS_FILE_PATH = path.join(LOG_PATH, 'metrics.log');
const STDOUT_FILE_PATH = path.join(LOG_PATH, 'stdout.log');

const REMOVE_TIMESTAMP = true;

const ACCESS_LOG_FMT = 'ip=:remote-addr ts=:date[iso] method=:method path=:url http_version=:http-version req_header:req[header] status=:status content_length=:res[content-length] content_type=":res[content-type]" ref=:referrer user_agent=:user-agent elapsed_ms=:total-time[3]';

/**
 * Logs to the console based on log level
 */
class ConsoleLogger {
  public readonly logLevel: LogLevel;
  private logger: Logger;
  private fileLogger: RotatingFileStream;
  private includeStackTrace: boolean;

  constructor(logLevel: LogLevel) {
    this.logger = new Logger(LoggerModes.Console, '', REMOVE_TIMESTAMP);
    if (LOG_TO_FILES) {
      this.fileLogger = new RotatingFileStream(STDOUT_FILE_PATH, true);
    }
    this.logLevel = logLevel;
    this.includeStackTrace = this.logLevel == LogLevel.debug ? true : false;
  }

  /**
   * Calls `this.debug`. Used for stream interfaces.
   * @param content Content to log
   */
  public write(content: string | object): void {
    this.debug(content);
  }

  public debug(content: string | object): void {
    if (this.logLevel > LogLevel.debug) {
      return;
    }
    this.log(LogStyle.info, content);
  }

  public imp(content: string | object): void {
    if (this.logLevel > LogLevel.important) {
      return;
    }
    this.log(LogStyle.imp, content);
  }

  public warn(content: string | object): void {
    this.log(LogStyle.warn, content);
  }

  public err(content: string | object): void {
    this.log(LogStyle.err, content);
  }

  private log(style: LogStyle, content: string | object): void {
    this.logger[style](content, this.includeStackTrace);
    if (LOG_TO_FILES) {
      const now = new Date();
      const message = `[${now.toUTCString()}] ${content}\n`;
      this.fileLogger.write(message);
    }
  }
}

interface ServiceLog {
  type: string;
  [key: string]: any;
}

/**
 * Logs content from app services to files
 */
class ServiceLogger {
  public service: string;
  public filePath: string;
  private stream: RotatingFileStream;

  constructor(service: string, filePath: string) {
    this.service = service;
    this.filePath = filePath;
    this.stream = new RotatingFileStream(this.filePath, true);
  }

  /**
   * Converts the service log to logfmt and writes it to `this.filePath`
   * @param serviceLog Service log object
   * @param logToConsole True to log to console in addition to file
   */
  public log(serviceLog: ServiceLog, logToConsole?: boolean): void {
    const now = new Date();
    // RFC1123 timestamp
    const message = `[${now.toUTCString()}] service=${this.service} ${ServiceLogger.format(serviceLog)}`;
    this.stream.write(util.format(message, '\n'));
    if ((LOG_LEVEL == LogLevel.debug) || logToConsole) {
      console.log(message);
    }
  }

  /**
   * Converts `serviceLog` key/value object to logfmt
   * @param serviceLog Service log object
   */
  public static format(serviceLog: ServiceLog): string {
    return logfmt.stringify(serviceLog);
  }
}

export const logger = new ConsoleLogger(LOG_LEVEL);

export const expressLoggers = buildExpressMiddleware();
function buildExpressMiddleware() {
  const middleware = [morgan('combined', { stream: logger })];
  if (LOG_TO_FILES) {
    const accessLogStream = new RotatingFileStream(ACCESS_FILE_PATH, true);
    middleware.push(morgan(ACCESS_LOG_FMT, { stream: accessLogStream }));
  }
  return middleware;
}

const anchorEventsLogger = new ServiceLogger('anchor', EVENTS_FILE_PATH);
const dbEventsLogger = new ServiceLogger('db', EVENTS_FILE_PATH);
const ethereumEventsLogger = new ServiceLogger('ethereum', EVENTS_FILE_PATH);

export const logEvent = {
  anchor: (log: ServiceLog, logToConsole?: boolean): void => anchorEventsLogger.log(log, logToConsole),
  db: (log: ServiceLog, logToConsole?: boolean): void => dbEventsLogger.log(log, logToConsole),
  ethereum: (log: ServiceLog, logToConsole?: boolean): void => ethereumEventsLogger.log(log, logToConsole)
}

const anchorMetricsLogger = new ServiceLogger('anchor', METRICS_FILE_PATH);
const ethereumMetricsLogger = new ServiceLogger('ethereum', METRICS_FILE_PATH);

export const logMetric = {
  anchor: (log: ServiceLog, logToConsole?: boolean): void => anchorMetricsLogger.log(log, logToConsole),
  ethereum: (log: ServiceLog, logToConsole?: boolean): void => ethereumMetricsLogger.log(log, logToConsole)
}
