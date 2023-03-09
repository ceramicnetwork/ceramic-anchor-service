// Mostly copied from PathReporter of io-ts.
// The difference is our ThrowDecoder returns a value if decoding succeeds.

import * as t from 'io-ts'
import { isLeft } from 'fp-ts/lib/Either.js'

function stringify(v: any): string {
  if (typeof v === 'function') {
    return t.getFunctionName(v)
  }
  if (typeof v === 'number' && !isFinite(v)) {
    if (isNaN(v)) {
      return 'NaN'
    }
    return v > 0 ? 'Infinity' : '-Infinity'
  }
  return JSON.stringify(v)
}

const ACTUAL_VALUE_LIMIT = 128

/**
 * Prepare error messages. Truncate actual passed value by `ACTUAL_VALUE_LIMIT` characters.
 */
export function makeErrorMessage(errors: Array<t.ValidationError>): string {
  const messages = errors.reduce<Array<string>>((acc, error) => {
    const context = error.context
    const path = context.reduce<string[]>((acc, entry) => acc.concat(entry.key), []).join('/')
    const errorEntry = context[context.length - 1]!
    const typeExpected = errorEntry.type.name
    let asString = stringify(errorEntry.actual)
    if (asString && asString.length > ACTUAL_VALUE_LIMIT)
      asString = `${asString.slice(0, ACTUAL_VALUE_LIMIT)}...`
    if (path) {
      return acc.concat(`Invalid value at ${path}: expected ${typeExpected} got ${asString}`)
    } else {
      return acc.concat(`Invalid value: expected ${typeExpected} got ${asString}`)
    }
  }, [])
  return messages.join(';')
}

export class ValidationError extends Error {}

/**
 * If decoding fails, throw an error.
 */
export const ThrowDecoder = {
  decode<A, I>(type: t.Decoder<I, A>, input: I): A {
    const validation = type.decode(input)
    if (isLeft(validation)) {
      throw new ValidationError(makeErrorMessage(validation.left))
    }
    return validation.right
  },
}
