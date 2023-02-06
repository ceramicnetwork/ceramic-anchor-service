import 'reflect-metadata'
import { SchedulerService } from '../scheduler-service.js'
import { config } from 'node-config-ts'
import { jest } from '@jest/globals'
import { createInjector } from 'typed-inject'

const injector = createInjector()
  .provideValue('config', Object.assign({}, config, { schedulerIntervalMS: 1000 }))
  .provideClass('schedulerService', SchedulerService)

describe('scheduler service', () => {
  jest.setTimeout(20000)

  test('will run the task repeatedly', (done) => {
    const numberOfRunsBeforeDone = 3
    const schedulerService = injector.resolve('schedulerService')

    const task = jest.fn()

    const runChecks = () => {
      // the task runs once right at the start before running every X seconds
      expect(task.mock.calls.length).toEqual(numberOfRunsBeforeDone + 1)
      done()
    }

    let count = 0
    task.mockImplementation(() => {
      if (count === numberOfRunsBeforeDone) {
        schedulerService.stop()
        runChecks()
      }

      count = count + 1
      return Promise.resolve()
    })

    schedulerService.start(task as any)
    // test doesn't complete until 'done()' is called
  })

  test('will continue if the task fails', (done) => {
    const numberOfRunsBeforeDone = 5
    const schedulerService = injector.resolve('schedulerService')

    const task = jest.fn()
    const runChecks = () => {
      // the task runs once right at the start before running every X seconds
      expect(task.mock.calls.length).toEqual(numberOfRunsBeforeDone + 1)
      done()
    }

    let count = 0
    task.mockImplementation(() => {
      if (count === numberOfRunsBeforeDone) {
        schedulerService.stop()
        runChecks()
      }

      count = count + 1

      // the last two runs will be rejected
      if (count > numberOfRunsBeforeDone - 2) {
        return Promise.reject('test error')
      }

      return Promise.resolve()
    })

    schedulerService.start(task as any)
    // test doesn't complete until 'done()' is called
  })
})
