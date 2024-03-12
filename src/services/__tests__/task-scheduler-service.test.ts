import 'reflect-metadata'
import { jest, describe, test, expect } from '@jest/globals'
import { TaskSchedulerService } from '../task-scheduler-service.js'
import { Utils } from '../../utils.js'
import { TestUtils } from '@ceramicnetwork/common'

describe('scheduler service', () => {
  jest.setTimeout(20000)

  test('will run the task repeatedly', async () => {
    const numberOfRunsBeforeDone = 3

    const task = jest.fn()
    const testScheduler = new TaskSchedulerService()

    let count = 0
    task.mockImplementation(async () => {
      count = count + 1
      return Promise.resolve()
    })

    testScheduler.start(task as any, 1000)
    await TestUtils.delay(1000 * numberOfRunsBeforeDone)
    await testScheduler.stop()
    expect(task.mock.calls.length).toBeGreaterThanOrEqual(numberOfRunsBeforeDone)
  })

  test('will stop if the task fails', async () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {})

    const task = jest.fn()
    const testScheduler = new TaskSchedulerService()

    let count = 0
    task.mockImplementation(async () => {
      count = count + 1

      if (count === 2) {
        throw Error('test error')
      }

      return
    })

    testScheduler.start(task as any, 1000)
    await TestUtils.waitForConditionOrTimeout(async () => {
      // @ts-ignore
      return testScheduler._subscription?.closed || false
    })
    expect(mockExit).toHaveBeenCalled()
  })

  test('Will complete current task if stop is called', async () => {
    let calls = 0
    const task = async () => {
      await Utils.delay(2000)
      calls = calls + 1
    }

    const testScheduler = new TaskSchedulerService()

    testScheduler.start(task as any, 1000)
    await Utils.delay(500)
    // stop is called during the task
    // stop should only return once the task completes
    await testScheduler.stop()
    await Utils.delay(3000)
    // task should have completed once
    expect(calls).toEqual(1)
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
