import { NextFunction, Request, Response, Handler } from 'express'
import * as DAG_JOSE from 'dag-jose'
import * as sha256 from '@stablelib/sha256'
import * as u8a from 'uint8arrays'
import { CARFactory } from 'cartonne'
import { Networks } from '@ceramicnetwork/common'
import { ALLOWED_IP_ADDRESSES } from './allowed-ip-addresses.js'
import { DID } from 'dids'
import KeyDIDResolver from 'key-did-resolver'

export type AuthOpts = {
  ceramicNetwork: string
}

export const authBearerRegex = new RegExp(/Bearer (.*)/)

const VERIFIER = new DID({ resolver: KeyDIDResolver.getResolver() })

// const allowRegisteredDIDSchema = Joi.object({
//   did: Joi.string().regex(didRegex).required(),
//   nonce: nonceValidation.required(),
// })

export function auth(opts: AuthOpts): Handler {
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
  return async function (req: Request, _res: Response, next: NextFunction) {
    // Allow if TESTNET
    if (opts.ceramicNetwork === Networks.TESTNET_CLAY) {
      return next()
    }

    // Allow if IP address is in allowlist
    const origin = parseOriginIP(req)
    let isAllowedIPAddress = false
    for (const ip of origin) {
      if (ALLOWED_IP_ADDRESSES[ip]) {
        isAllowedIPAddress = true
        break
      }
    }
    if (isAllowedIPAddress) {
      return next()
    }

    // Authorization Header
    const authorizationHeader = req.get('Authorization')
    if (authorizationHeader) {
      const match = authBearerRegex.exec(authorizationHeader)
      if (match && match[1]) {
        const jws = match[1]
        const verified = await VERIFIER.verifyJWS(jws)
        const did = verified.didResolutionResult.didDocument?.id
        const nonce = verified.payload?.['nonce']
        const digest = verified.payload?.['digest']
        if (did && nonce && digest) {
          return next()
        }
      }
    }
    // Throw unauthorized

    const didHeader = req.headers['did']
    const body = req.body
    if (didHeader && body && Object.keys(body).length > 0) {
      const digest = buildBodyDigest(req.headers['content-type'], body)
      if (req.headers['digest'] == digest) {
        return next()
      } else {
        throw Error('Body digest verification failed')
      }
    }
    return next()
  }
}

function buildBodyDigest(contentType: string | undefined, body: any): string | undefined {
  if (!body) return

  let hash: Uint8Array | undefined

  if (contentType) {
    if (contentType.includes('application/vnd.ipld.car')) {
      const carFactory = new CARFactory()
      carFactory.codecs.add(DAG_JOSE)
      // console.log('Will build a car file from req.body', body)
      // try {
      //   console.log('Will build a car file from req.body (as utf8 string)', u8a.toString(body, 'base64'))
      // } catch(e) {
      //   console.log('Couldn\'t convert req.body to string: ', e)
      // }
      const car = carFactory.fromBytes(body)
      const root = car.roots[0]
      if (!root) throw Error('Missing CAR root')
      return root.toString()
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

function parseOriginIP(req: Request): Array<string> {
  const sourceIp = req.get('sourceIp')
  if (sourceIp) return [sourceIp]
  const xForwardedForHeader = req.get('X-Forwarded-For')
  if (!xForwardedForHeader) {
    return []
  }
  if (Array.isArray(xForwardedForHeader)) {
    return xForwardedForHeader.map((s) => s.trim())
  } else {
    return xForwardedForHeader.split(',').map((s) => s.trim())
  }
}
