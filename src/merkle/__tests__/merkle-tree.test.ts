import { describe, expect, test } from '@jest/globals'
import { pathByIndex } from '../merkle-tree.js'
import { path } from './path.util.js'

describe('getPath', () => {
  test('index overflow', () => {
    expect(() => pathByIndex(10, 3)).toThrow()
  })
  test('single leaf', () => {
    expect(pathByIndex(0, 1)).toEqual(path`L`)
  })
  test('calculate path by index', () => {
    // Special cases
    expect(pathByIndex(0, 1)).toEqual(path`L`)
    expect(pathByIndex(0, 2)).toEqual(path`L`)
    expect(pathByIndex(1, 2)).toEqual(path`R`)
    // Odd
    expect(pathByIndex(0, 3)).toEqual(path`L`)
    expect(pathByIndex(1, 3)).toEqual(path`R/L`)
    expect(pathByIndex(2, 3)).toEqual(path`R/R`)
    // Even
    expect(pathByIndex(0, 4)).toEqual(path`L/L`)
    expect(pathByIndex(1, 4)).toEqual(path`L/R`)
    expect(pathByIndex(2, 4)).toEqual(path`R/L`)
    expect(pathByIndex(3, 4)).toEqual(path`R/R`)
  })
})
