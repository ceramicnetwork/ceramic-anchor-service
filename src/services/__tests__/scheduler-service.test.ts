import 'reflect-metadata'
import { SchedulerService } from '../scheduler-service'
import { config } from 'node-config-ts'
import { container } from 'tsyringe'
import { jest } from '@jest/globals'

describe('scheduler service', () => {
  jest.setTimeout(20000)
  beforeAll(async () => {
    container.registerInstance('config', Object.assign({}, config, { schedulerIntervalMS: 3000 }))
    container.registerSingleton('schedulerService', SchedulerService)
  })

  test('will run the task repeatedly', (done) => {
    const numberOfRunsBeforeDone = 3
    const schedulerService = container.resolve<SchedulerService>('schedulerService')

    let count = 0
    const task = jest.fn(() => {
      if (count === numberOfRunsBeforeDone) {
        schedulerService.stop()
        runChecks()
      }

      count = count + 1
      return Promise.resolve()
    })

    schedulerService.start(task)
    const runChecks = () => {
      // the task runs once right at the start before running every X seconds
      expect(task.mock.calls.length).toEqual(numberOfRunsBeforeDone + 1)
      done()
    }
  })

  test('will continue if the task fails', (done) => {
    const numberOfRunsBeforeDone = 5
    const schedulerService = container.resolve<SchedulerService>('schedulerService')

    let count = 0
    const task = jest.fn(() => {
      if (count === numberOfRunsBeforeDone) {
        schedulerService.stop()
        runChecks()
      }

      count = count + 1

      if (count > 3) {
        return Promise.reject('test error')
      }

      return Promise.resolve()
    })

    schedulerService.start(task)
    const runChecks = () => {
      // the task runs once right at the start before running every X seconds
      expect(task.mock.calls.length).toEqual(numberOfRunsBeforeDone + 1)
      done()
    }
  })
})
