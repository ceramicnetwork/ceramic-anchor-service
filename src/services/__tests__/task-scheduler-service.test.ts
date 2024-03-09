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

  test('will stop if the task fails', (done) => {
    const task = jest.fn()
    const testScheduler = new TaskSchedulerService()

    let count = 0
    task.mockImplementation(async () => {
      count = count + 1

      if (count === 2) {
        return Promise.reject('test error')
      }

      return Promise.resolve()
    })

    testScheduler.start(task as any, 1000)
    // @ts-ignore
    testScheduler._subscription?.add(() => {
      expect(task.mock.calls.length).toEqual(2)
      testScheduler.stop()
      done()
    })
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

  test('Will run cbAfterNoOp after failure if set', async () => {
    let completedOnce = false
    const task = jest.fn()
    task.mockImplementation(async (): Promise<boolean> => {
      if (!completedOnce) {
        completedOnce = true
        return Promise.resolve(true)
      }
      return Promise.resolve(false)
    })
    const cbAfterNoOp = jest.fn(() => Promise.resolve())

    const testScheduler = new TaskSchedulerService()
    testScheduler.start(task as any, 1000, cbAfterNoOp)

    await Utils.delay(5000)

    await testScheduler.stop()
    expect(task.mock.calls.length).toEqual(2)
    expect(cbAfterNoOp.mock.calls.length).toEqual(1)
  })
})
