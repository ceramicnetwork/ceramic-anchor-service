import express from 'express'
import asyncify from 'express-asyncify'
import { validate } from 'express-validation'
import { registerValidation, revokeValidation } from '../validators/did.js'
import { ClientFacingError } from '../utils/errorHandling.js'
import { Req, Res } from '../utils/reqres.js'
import { checkUserIsAdmin } from '../utils/auth.js'

const router = asyncify(express.Router())

/**
 * Register DID
 */
router.post('/', validate(registerValidation), async (req: Req, res: Res) => {
  let userIsAdmin = false
  if (req.headers.authorization) {
    userIsAdmin = checkUserIsAdmin(req.headers.authorization)
  }
  if (process.env.ENABLE_REGISTRATION == 'false' && !userIsAdmin) {
    return res.send({ message: 'We have reached capacity! We are not accepting new registrations at this time. Please try again later.'})
  }
  const data = await req.customContext.db.registerDIDs(req.body.email, req.body.otp, req.body.dids)
  // TODO: create api key for did and email address
  if (data) {
    return res.send(data)
  }
  throw new ClientFacingError('Could not register DID')
})

/**
 * Revoke DID
 */
router.patch('/:did', validate(revokeValidation), async (req: Req, res: Res) => {
  const data = await req.customContext.db.revokeDID(req.body.email, req.body.otp, req.params.did)
  if (data) {
    return res.send(data)
  }
  throw new ClientFacingError('Could not revoke DID')
})

export const did = router
