import rfs from 'rotating-file-stream'
import { Logger as logger} from '@overnightjs/logger'

const LOG_PATH = process.env.LOG_PATH || '/usr/local/var/log/cas'
const METRICS_LOG_PATH = process.env.METRICS_LOG_PATH || LOG_PATH + '/metrics'

export const accessLogStream = rfs.createStream(`${LOG_PATH}/access.log`, {
  size: "10M", // rotate every 10 MegaBytes written
  interval: "1d", // rotate daily
  compress: "gzip" // compress rotated files
})

export const debugLogStream = rfs.createStream(`${LOG_PATH}/debug.log`, {
  size: "10M", // rotate every 10 MegaBytes written
  interval: "1d", // rotate daily
  compress: "gzip" // compress rotated files
})

export const errorLogStream = rfs.createStream(`${LOG_PATH}/error.log`, {
  size: "10M", // rotate every 10 MegaBytes written
  interval: "1d", // rotate daily
  compress: "gzip" // compress rotated files
})

export const metricsLogStream = rfs.createStream(`${METRICS_LOG_PATH}/out.log`, {
  size: "10M",
  interval: "1d",
  compress: "gzip"
})

export const logWrite = {
  write: logger.Info
}
