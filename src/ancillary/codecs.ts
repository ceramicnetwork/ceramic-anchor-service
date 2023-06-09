import { array, Codec, type Context, refinement, string, type Validation } from 'codeco'
import { PathDirection } from '@ceramicnetwork/anchor-utils'

/**
 * codeco codec for controllers array: `[controllers]`.
 */
export const controllers = refinement(array(string), (arr) => arr.length === 1, '[controllers]')

export class PathLineCodec extends Codec<Array<PathDirection>, string> {
  constructor() {
    super(`PathLine`)
  }

  is(input: unknown): input is Array<PathDirection> {
    return (
      Array.isArray(input) &&
      input.every((element) => {
        switch (element) {
          case PathDirection.L:
            return true
          case PathDirection.R:
            return true
          default:
            return false
        }
      })
    )
  }

  encode(line: Array<PathDirection>): string {
    return line.join('/')
  }

  decode(input: string, context: Context): Validation<Array<PathDirection>> {
    const elements = input.split('/')
    const result: Array<PathDirection> = []
    for (const element of elements) {
      const number = parseInt(element, 10)
      if (String(number) !== element) {
        return context.failure(`Invalid path line`)
      }
      switch (number) {
        case PathDirection.R:
          result.push(PathDirection.R)
          break
        case PathDirection.L:
          result.push(PathDirection.L)
          break
        default:
          return context.failure(`Invalid path line`)
      }
    }
    return context.success(result)
  }
}

export const pathLine = new PathLineCodec()
