import type { Knex } from 'knex'
import { ServiceMetrics as Metrics } from '@ceramicnetwork/observability'
import { logger } from '../logger/index.js'
import { METRIC_NAMES } from '../settings.js'
import { Utils } from '../utils.js'
import { Options } from './repository-types.js'

const TRANSACTION_MUTEX_ID = 4532

export class TransactionRepository {
  static inject = ['dbConnection'] as const

  constructor(private readonly connection: Knex) {}

  /**
   * Acquires the transaction mutex before performing the operation.
   *
   * @param operation
   * @param maxAttempts Maximum amount of attempt to acquire the transaction mutex (defaults to Infinity)
   * @param delayMS The number of MS to wait between attempt (defaults to 5000 MS)
   * @returns
   */
  async withTransactionMutex<T>(
    operation: () => Promise<T>,
    maxAttempts = Infinity,
    delayMS = 5000,
    options: Options = {}
  ): Promise<T> {
    const { connection = this.connection } = options

    return connection.transaction(async (trx) => {
      let attempt = 1
      while (attempt <= maxAttempts) {
        logger.debug(`Attempt ${attempt} at acquiring the transaction mutex before operation`)
        if (attempt > 5) Metrics.count(METRIC_NAMES.MANY_ATTEMPTS_TO_ACQUIRE_MUTEX, 1)

        const {
          rows: [{ pg_try_advisory_xact_lock: success }],
        } = await trx.raw(`SELECT pg_try_advisory_xact_lock(${TRANSACTION_MUTEX_ID})`)

        if (success) {
          return operation()
        }

        attempt++

        await Utils.delay(delayMS)
      }

      throw new Error(`Failed to acquire transaction mutex after ${maxAttempts} tries`)
    })
  }
}
