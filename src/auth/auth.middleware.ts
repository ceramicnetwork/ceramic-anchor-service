import { NextFunction, Request, Response, Handler } from 'express'
import * as DAG_JOSE from 'dag-jose'
import * as sha256 from '@stablelib/sha256'
import * as u8a from 'uint8arrays'
import { CARFactory, CAR } from 'cartonne'
import { Networks } from '@ceramicnetwork/common'
import { ALLOWED_IP_ADDRESSES } from './allowed-ip-addresses.js'
import { DID } from 'dids'
import KeyDIDResolver from 'key-did-resolver'

export type AuthOpts = {
  ceramicNetwork: string
  allowedDIDs: Set<string>
  isRelaxed: boolean
}

export const AUTH_BEARER_REGEXP = new RegExp(/Bearer (.*)/)
const CAR_FACTORY = new CARFactory()
CAR_FACTORY.codecs.add(DAG_JOSE)

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
  return async function (req: Request, res: Response, next: NextFunction) {
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
    const authorizationHeader = req.get('Authorization') || ''
    const bearerTokenMatch = AUTH_BEARER_REGEXP.exec(authorizationHeader)
    if (bearerTokenMatch && bearerTokenMatch[1]) {
      const jws = bearerTokenMatch[1]
      const verifyJWSResult = await VERIFIER.verifyJWS(jws)
      const did = verifyJWSResult.didResolutionResult.didDocument?.id
      const nonce = verifyJWSResult.payload?.['nonce']
      const digest = verifyJWSResult.payload?.['digest']
      if (did && nonce && digest && isAllowedDID(did, opts)) {
        const body = req.body
        const contentType = req.get('Content-Type')
        const digestCalculated = buildBodyDigest(contentType, body)
        const isCorrectDigest = digestCalculated == digest
        if (isCorrectDigest) {
          return next()
        }
      }
    }
    return res.status(403).json({ error: 'Unauthorized' })
  }
}

function isAllowedDID(did: string, opts: AuthOpts): boolean {
  if (opts.isRelaxed) {
    // TODO Notify here
    return true
  } else {
    return opts.allowedDIDs.has(did)
  }
}

function buildBodyDigest(contentType: string | undefined, body: any): string | undefined {
  if (!body) return

  let hash: Uint8Array | undefined

  if (contentType) {
    if (contentType.includes('application/vnd.ipld.car')) {
      let car: CAR
      try {
        car = CAR_FACTORY.fromBytes(body)
      } catch (e) {
        return undefined
      }
      const root = car.roots[0]
      if (!root) {
        return undefined
      }
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
