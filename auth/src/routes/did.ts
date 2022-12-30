import express from 'express'
import asyncify from 'express-asyncify'
import { validate } from 'express-validation'
import { getNonceValidation, registerValidation } from '../validators/did.js'
import { ClientFacingError } from '../utils/errorHandling.js'
import { Req, Res } from '../utils/reqres.js'

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
  // TODO: validate the did in the signature matches here
  const nonce = await req.customContext.db.getNonce(req.params.did) ?? -1
  if (nonce >= 0) {
    return res.send({ nonce })
  }
  throw new ClientFacingError('Could not retrieve nonce')
})

/**
 * Revoke DID
 */
router.delete('/:did', async (req: Req, res: Res) => {
  const validDID = req.params.did ?? undefined
  const otp = req.params.code ?? undefined
  if (validDID) {
    const email = await req.customContext.db.getEmail(validDID)
    if (email) {
      const success = await req.customContext.db.revokeDID(email, otp, validDID)
      if (success) {
        return res.send({ message: 'Revoked DID' })
      }
    }
  }
  throw new ClientFacingError('Could not revoke DID')
})

export const did = router
