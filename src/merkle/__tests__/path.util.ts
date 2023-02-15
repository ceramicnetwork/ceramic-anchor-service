import { PathDirection } from '../merkle-elements.js'

/**
 * Path from string literal
 * @param input - path as slash-separated `L` and `R` symbols
 */
export function path(input: TemplateStringsArray): Array<PathDirection> {
  return input
    .join('')
    .split('/')
    .map((s) => {
      switch (s) {
        case 'L':
          return PathDirection.L
        case 'R':
          return PathDirection.R
        default:
          throw new Error(`Can not handle ${s} as path direction`)
      }
    })
}
