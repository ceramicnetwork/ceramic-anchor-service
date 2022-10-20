import 'reflect-metadata'
import { jest } from '@jest/globals'
import { container } from 'tsyringe'
import type { Knex } from 'knex'
import { Utils } from '../../utils.js'
import { createDbConnection } from '../../db-connection.js'
import { TransactionRepository } from '../transaction-repository.js'

describe('transaction repository test', () => {
  jest.setTimeout(10000)
  let connection: Knex
  let transactionRepository: TransactionRepository

  beforeAll(async () => {
    connection = await createDbConnection()

    container.registerInstance('dbConnection', connection)
    container.registerSingleton('transactionRepository', TransactionRepository)

    transactionRepository = container.resolve<TransactionRepository>('transactionRepository')
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
      const childContainer = container.createChildContainer()
      const connection2 = await createDbConnection()
      childContainer.registerInstance('dbConnection', connection2)
      childContainer.registerSingleton('transactionRepository', TransactionRepository)
      const transactionRepository2 =
        childContainer.resolve<TransactionRepository>('transactionRepository')

      try {
        await transactionRepository.withTransactionMutex(async () => {
          await expect(
            transactionRepository2.withTransactionMutex(() => Utils.delay(1000), 2, 1000)
          ).rejects.toThrow(/Failed to acquire transaction mutex/)
        })

        await transactionRepository2.withTransactionMutex(() => Utils.delay(1000))
      } finally {
        await connection2.destroy()
        await childContainer.dispose()
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
