import express from 'express'
import asyncify from 'express-asyncify'
import { validate } from 'express-validation'
import { getNonceValidation, registerValidation, revokeValidation } from '../validators/did.js'
import { ClientFacingError } from '../utils/errorHandling.js'
import { authBearerOnlyRegex, Req, Res } from '../utils/reqres.js'
import { checkValidSignature } from '../utils/did.js'

const router = asyncify(express.Router())

/**
 * Register DID
 */
router.post('/', validate(registerValidation), async (req: Req, res: Res) => {
  const data = await req.customContext.db.registerDIDs(req.body.email, req.body.otp, req.body.dids)
  if (data) {
    return res.send(data)
  }
  throw new ClientFacingError('Could not register DID')
})

/**
 * Get last recorded nonce
 */
router.get('/:did/nonce', validate(getNonceValidation), async (req: Req, res: Res) => {
  const jws = req.headers.authorization?.replace(authBearerOnlyRegex, '')
  const valid = await checkValidSignature(req.params.did, jws || '')
  if (!valid) throw new ClientFacingError('Invalid signature')
  const nonce = await req.customContext.db.getNonce(req.params.did) ?? -1
  if (nonce >= 0) {
    return res.send({ nonce })
  }
  throw new ClientFacingError('Could not retrieve nonce')
})

/**
 * Revoke DID
 */
router.put('/:did', validate(revokeValidation), async (req: Req, res: Res) => {
  const success = await req.customContext.db.revokeDID(req.body.email, req.body.otp, req.body.did)
  if (success) {
    return res.send({ message: 'Revoked DID' })
  }
  throw new ClientFacingError('Could not revoke DID')
})

export const did = router
