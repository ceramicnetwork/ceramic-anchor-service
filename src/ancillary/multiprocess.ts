import EventEmitter from 'node:events'
import cluster from 'node:cluster'
import { cpus } from 'node:os'

export type MultiprocessOptions = {
  /**
   * If `true`, a single worker failure should not kill us all. A failed worker will get respawned.
   */
  keepAlive: boolean
  /**
   * If `true`, the workers are started right away.
   */
  autostart: boolean
  /**
   * Number of child processes to spawn. By default, number of child processes equals to number of CPUs.
   */
  workers: number | undefined
}

const DEFAULT_OPTIONS: Partial<MultiprocessOptions> = {
  keepAlive: true,
  autostart: true,
}

export type TeardownFunction = () => void
export type MultiprocessWork = (() => void) | (() => TeardownFunction)

export class Multiprocess extends EventEmitter {
  private keepAlive: boolean
  private readonly work: MultiprocessWork
  private teardownFn: TeardownFunction | undefined = undefined

  constructor(work: MultiprocessWork, options: Partial<MultiprocessOptions>) {
    super()
    const effectiveOptions = { ...DEFAULT_OPTIONS, ...options }
    if (!work || typeof work !== 'function') {
      throw new Error('You need to provide a worker function.')
    }

    this.keepAlive = effectiveOptions.keepAlive ?? true
    this.work = () => {
      this.teardownFn = work() || undefined
    }
    this.fork = this.fork.bind(this)
    this.stop = this.stop.bind(this)

    if (cluster.isPrimary) {
      cluster.setupPrimary({
        silent: false,
      })
    }

    if (effectiveOptions.autostart) {
      if (cluster.isWorker) {
        this.work()
      } else {
        this.start(effectiveOptions)
      }
    }
  }

  start(options: Partial<MultiprocessOptions>) {
    if (options.workers === 0) {
      this.work()
      return
    }
    const workersFromEnv = process.env['MULTIPROCESS_SIZE']
      ? parseInt(process.env['MULTIPROCESS_SIZE'], 10)
      : undefined
    let processes = options.workers || workersFromEnv || cpus().length
    process.on('SIGINT', this.stop).on('SIGTERM', this.stop)
    cluster.on('online', (wrk) => {
      this.emit('worker', wrk.process.pid)
    })
    cluster.on('exit', (wrk) => {
      this.emit('exit', wrk.process.pid)
      return this.fork()
    })

    while (processes) {
      processes -= 1
      cluster.fork()
    }
  }

  stop() {
    if (cluster.isPrimary) {
      this.keepAlive = false
      for (const worker of Object.values(cluster.workers || {})) {
        if (worker) {
          worker.process.kill()
          worker.kill()
        }
      }
      this.teardownFn?.()
      this.emit('offline')
    }
  }

  fork(): void {
    if (this.keepAlive) {
      cluster.fork()
    }
  }
}

/**
 * Leverage node:cluster to spawn multiple identical child processes.
 *
 * @param work - execute inside a worker.
 * @param options
 */
export function multiprocess(work: MultiprocessWork, options: Partial<MultiprocessOptions> = {}) {
  return new Multiprocess(work, options)
}
