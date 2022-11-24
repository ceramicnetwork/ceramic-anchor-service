import 'reflect-metadata'
import { jest } from '@jest/globals'
import type { Knex } from 'knex'
import { Utils } from '../../utils.js'
import { createDbConnection } from '../../db-connection.js'
import { TransactionRepository } from '../transaction-repository.js'
import { createInjector } from 'typed-inject'

describe('transaction repository test', () => {
  jest.setTimeout(10000)
  let connection: Knex
  let transactionRepository: TransactionRepository

  beforeAll(async () => {
    connection = await createDbConnection()

    const injector = createInjector()
      .provideValue('dbConnection', connection)
      .provideClass('transactionRepository', TransactionRepository)

    transactionRepository = injector.resolve('transactionRepository')
  })

  afterAll(async () => {
    await connection.destroy()
  })

  describe('transaction mutex', () => {
    test('Can successfully acquire transaction mutex', async () => {
      await transactionRepository.withTransactionMutex(async () => {
        await Utils.delay(1000)
      })
    })

    test('Will block until can acquire transaction mutex', async () => {
      const connection2 = await createDbConnection()
      const injector2 = createInjector()
        .provideValue('dbConnection', connection2)
        .provideClass('transactionRepository', TransactionRepository)
      const transactionRepository2 = injector2.resolve('transactionRepository')

      try {
        await transactionRepository.withTransactionMutex(async () => {
          await expect(
            transactionRepository2.withTransactionMutex(() => Utils.delay(1000), 2, 1000)
          ).rejects.toThrow(/Failed to acquire transaction mutex/)
        })

        await transactionRepository2.withTransactionMutex(() => Utils.delay(1000))
      } finally {
        await connection2.destroy()
        await injector2.dispose()
      }
    })

    test('Will unlock the transaction mutex if the operation fails', async () => {
      await expect(
        transactionRepository.withTransactionMutex(async () => {
          throw new Error('test error')
        })
      ).rejects.toThrow(/test error/)

      await transactionRepository.withTransactionMutex(() => Utils.delay(1000))
    })
  })
})
