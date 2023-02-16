import { Hash, createHash } from 'crypto'
import { NextFunction, Request, Response } from 'express'

export const auth = buildExpressMiddleware()
function buildExpressMiddleware() {
    return function(req: Request, res: Response, next: NextFunction) {
        if (req.headers) {
            if (req.headers.did && req.body) {
                const bodyHash = buildBodyHash(req.headers['content-type'], req.body)
                return req.headers.bodyHash == bodyHash
            }
        }
        next()
    }
}

function buildBodyHash(contentType: string, body: any): string | undefined {
    if (!body) return

    let hash: Hash

    if (contentType) {
      if (contentType.includes('application/vnd.ipld.car')) {
        const carFactory = new CARFactory()
        const car = carFactory.fromBytes(u8a.fromString(body, 'binary'))
        hash = createHash('sha256').update(car.roots[0].toString())
      } else if (contentType.includes('application/json')) {
        hash = createHash('sha256').update(JSON.stringify(body))
      }
    }

    if (!hash) {
      // Default to hashing stringified body
      hash = createHash('sha256').update(JSON.stringify(body))
    }

    return hash.digest('hex')
  }