import { expect } from '@jest/globals'

/**
 * Expect that `input` is truthy and tells TS that.
 */
export function expectPresent<T>(input: T): asserts input {
  expect(input).toBeDefined()
}
