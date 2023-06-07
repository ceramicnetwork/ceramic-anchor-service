import { describe, test, expect } from '@jest/globals'
import { validate, isRight } from 'codeco'
import { pathLine } from '../codecs.js'

describe('pathLine', () => {
  test('ok', () => {
    expect(isRight(validate(pathLine, '0'))).toBeTruthy()
    expect(isRight(validate(pathLine, '0/1'))).toBeTruthy()
    expect(isRight(validate(pathLine, '0/1/1'))).toBeTruthy()
  })
  test('fail', () => {
    expect(isRight(validate(pathLine, ''))).toBeFalsy()
    expect(isRight(validate(pathLine, '0/'))).toBeFalsy()
    expect(isRight(validate(pathLine, '0/2'))).toBeFalsy()
    expect(isRight(validate(pathLine, '/0/2'))).toBeFalsy()
  })
})
