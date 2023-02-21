import * as sha256 from '@stablelib/sha256'
import { CARFactory } from 'cartonne'
import { NextFunction, Request, Response } from 'express'
import * as u8a from 'uint8arrays'

export const auth = buildExpressMiddleware()
function buildExpressMiddleware() {
  /**
   * @dev If the request has a did header, it means we have already confirmed the did
   * is registered. If the request has no did, it means we have already
   * confirmed the IP address making the request is on our allowlist. If the
   * request contains a body, it means we have already verified the digest
   * header can be trusted here.
   * All of this logic mentioned above lives outside of this app.
   * Notice that the absense of a did header or body bypasses any checks below
   * this app will still work if the logice above is not in place.
   */
    return function(req: Request, res: Response, next: NextFunction) {
        if (req.headers) {
            if (req.headers['did'] && req.body) {
                const digest = buildBodyDigest(req.headers['content-type'], req.body)
                if (req.headers['digest'] == digest) {
                  next()
                } else {
                  throw Error('Body digest verification failed')
                }
            }
        }
        next()
    }
}

function buildBodyDigest(contentType: string | undefined, body: any): string | undefined {
    if (!body) return

    let hash: Uint8Array | undefined

    if (contentType) {
      if (contentType.includes('application/vnd.ipld.car')) {
        const carFactory = new CARFactory()
        const car = carFactory.fromBytes(body)
        if (!car.roots[0]) throw Error('Missing CAR root')
        return car.roots[0].toString()
      } else if (contentType.includes('application/json')) {
        hash = sha256.hash(u8a.fromString(JSON.stringify(body)))
      }
    }

    if (!hash) {
      // Default to hashing stringified body
      hash = sha256.hash(u8a.fromString(JSON.stringify(body)))
    }

    return `0x${u8a.toString(hash, 'base16')}`
  }