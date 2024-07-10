import { NextFunction, Request, Response, Handler } from 'express'
import * as DAG_JOSE from 'dag-jose'
import * as sha256 from '@stablelib/sha256'
import * as u8a from 'uint8arrays'
import { CARFactory, CAR } from 'cartonne'
import { DiagnosticsLogger } from '@ceramicnetwork/common'
import { DID } from 'dids'
import KeyDIDResolver from 'key-did-resolver'
import { ServiceMetrics } from '@ceramicnetwork/observability'
import { METRIC_NAMES } from '../settings.js'

export type AuthOpts = {
  logger?: DiagnosticsLogger
  allowedDIDs: Set<string>
  isRelaxed: boolean
}

export const AUTH_BEARER_REGEXP = new RegExp(/Bearer (.*)/)
const CAR_FACTORY = new CARFactory()
CAR_FACTORY.codecs.add(DAG_JOSE)

const VERIFIER = new DID({ resolver: KeyDIDResolver.getResolver() })

enum DISALLOW_REASON {
  LAMBDA_INVALID_DIGEST = 'lambda-invalid-digest',
  DID_ALLOWLIST_NO_HEADER = 'did-allowlist-no-header',
  DID_ALLOWLIST_NO_DID = 'did-allowlist-no-did',
  DID_ALLOWLIST_NO_FIELDS = 'did-allowlist-no-fields',
  DID_ALLOWLIST_REJECTED = 'did-allowlist-rejected',
  DID_ALLOWLIST_INVALID_DIGEST = 'did-allowlist-invalid-digest',
}

export function parseAllowedDIDs(dids: string | undefined): Set<string> {
  if (dids) {
    const parts = dids.split(',')
    return new Set(parts)
  } else {
    return new Set()
  }
}

export function auth(opts: AuthOpts): Handler {
  const hasAllowedDIDsList = opts.allowedDIDs.size > 0

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
    const logger = opts.logger

    // Use auth lambda
    const didFromHeader = req.header('did')
    if (didFromHeader && req.body && Object.keys(req.body).length > 0) {
      const digest = buildBodyDigest(req.header('Content-Type'), req.body)
      if (req.header('digest') === digest) {
        ServiceMetrics.count(METRIC_NAMES.AUTH_ALLOWED, 1, { did: didFromHeader })
        return next()
      } else {
        logger?.verbose(`Disallowed: Auth lambda: Invalid digest`)
        return disallow(res, DISALLOW_REASON.LAMBDA_INVALID_DIGEST)
      }
    }

    // Authorization Header
    if (hasAllowedDIDsList) {
      const authorizationHeader = req.header('Authorization') || ''
      const bearerTokenMatch = AUTH_BEARER_REGEXP.exec(authorizationHeader)
      const jws = bearerTokenMatch?.[1]
      if (!jws) {
        logger?.verbose(`Disallowed: No authorization header`)
        return disallow(res, DISALLOW_REASON.DID_ALLOWLIST_NO_HEADER)
      }
      const verifyJWSResult = await VERIFIER.verifyJWS(jws)
      const did = verifyJWSResult.didResolutionResult.didDocument?.id
      if (!did) {
        logger?.verbose(`Disallowed: No DID`)
        return disallow(res, DISALLOW_REASON.DID_ALLOWLIST_NO_DID)
      }
      const nonce = verifyJWSResult.payload?.['nonce']
      const digest = verifyJWSResult.payload?.['digest']
      if (!nonce || !digest) {
        logger?.verbose(`Disallowed: No nonce or No digest`)
        return disallow(res, DISALLOW_REASON.DID_ALLOWLIST_NO_FIELDS)
      }
      if (!isAllowedDID(did, opts)) {
        logger?.verbose(`Disallowed: ${did}`)
        return disallow(res, DISALLOW_REASON.DID_ALLOWLIST_REJECTED)
      }

      const body = req.body
      const contentType = req.header('Content-Type')
      const digestCalculated = buildBodyDigest(contentType, body)
      if (digestCalculated !== digest) {
        logger?.verbose(`Disallowed: Incorrect digest for DID ${did}`)
        return disallow(res, DISALLOW_REASON.DID_ALLOWLIST_INVALID_DIGEST)
      }
      const relaxedLabel = opts.isRelaxed ? 1 : 0
      ServiceMetrics.count(METRIC_NAMES.AUTH_ALLOWED, 1, { did: did, relaxed: relaxedLabel })
    }
    return next()
  }
}

function disallow(res: Response, reason: DISALLOW_REASON): Response {
  ServiceMetrics.count(METRIC_NAMES.AUTH_DISALLOWED, 1, { reason: reason })
  return res.status(403).json({ error: 'Unauthorized' })
}

function isAllowedDID(did: string, opts: AuthOpts): boolean {
  if (opts.isRelaxed) {
    opts.logger?.verbose(`Allowed: Relaxed: ${did}`)
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
