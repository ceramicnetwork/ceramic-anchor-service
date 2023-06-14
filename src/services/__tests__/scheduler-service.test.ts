import 'reflect-metadata'
import { jest, describe, test, expect } from '@jest/globals'
import { TaskSchedulerService } from '../task-scheduler-service.js'
import { Utils } from '../../utils.js'

describe('scheduler service', () => {
  jest.setTimeout(20000)

  test('will run the task repeatedly', (done) => {
    const numberOfRunsBeforeDone = 3

    const task = jest.fn()
    const testScheduler = new TaskSchedulerService()

    const runChecks = () => {
      // the task runs once right at the start before running every X seconds
      expect(task.mock.calls.length).toEqual(numberOfRunsBeforeDone + 1)
      done()
    }

    let count = 0
    task.mockImplementation(async () => {
      if (count === numberOfRunsBeforeDone) {
        testScheduler.stop()
        runChecks()
      }

      count = count + 1
      return Promise.resolve()
    })

    testScheduler.start(task as any, 1000)
    // test doesn't complete until 'done()' is called
  })

  test('will continue if the task fails', (done) => {
    const numberOfRunsBeforeDone = 5
    const task = jest.fn()
    const testScheduler = new TaskSchedulerService()

    const runChecks = () => {
      // the task runs once right at the start before running every X seconds
      expect(task.mock.calls.length).toEqual(numberOfRunsBeforeDone + 1)
      Utils.delay(3000).then(() => {
        done()
      })
    }

    let count = 0
    task.mockImplementation(async () => {
      if (count === numberOfRunsBeforeDone) {
        testScheduler.stop()
        runChecks()
      }

      count = count + 1

      // the last two runs will be rejected
      if (count > numberOfRunsBeforeDone - 2) {
        return Promise.reject('test error')
      }

      return Promise.resolve()
    })

    testScheduler.start(task as any, 1000)
    // test doesn't complete until 'done()' is called
  })

  test('Will complete current task if stop is called', (done) => {
    let calls = 0
    const task = async () => {
      await Utils.delay(2000)
      calls = calls + 1
    }
    const testScheduler = new TaskSchedulerService()

    // stop is called during the task
    // stop should only return once the task completes
    Utils.delay(1000).then(async () => {
      await testScheduler.stop()
      await Utils.delay(3000)
      // task should have compelted once
      expect(calls).toEqual(1)
      done()
    })

    testScheduler.start(task as any, 1000)
    // test doesn't complete until 'done()' is called
  })
})
