import * as sha256 from '@stablelib/sha256'
import { CARFactory } from 'cartonne'
import { NextFunction, Request, Response } from 'express'
import * as u8a from 'uint8arrays'

export const auth = buildExpressMiddleware()
function buildExpressMiddleware() {
    return function(req: Request, res: Response, next: NextFunction) {
        if (req.headers) {
            if (req.headers.did && req.body) {
                const digest = buildBodyDigest(req.headers['content-type'], req.body)
                return req.headers.digest == digest
            }
        }
        next()
    }
}

function buildBodyDigest(contentType: string, body: any): string | undefined {
    if (!body) return

    let hash: sha256.SHA256

    if (contentType) {
      if (contentType.includes('application/vnd.ipld.car')) {
        const carFactory = new CARFactory()
        const car = carFactory.fromBytes(body)
        return car.roots[0].toString()
      } else if (contentType.includes('application/json')) {
        hash = new sha256.SHA256().update(u8a.fromString(JSON.stringify(body)))
      }
    }

    if (!hash) {
      // Default to hashing stringified body
      hash = new sha256.SHA256().update(u8a.fromString(JSON.stringify(body)))
    }

    return `0x${u8a.toString(hash.digest(), 'base16')}`
  }