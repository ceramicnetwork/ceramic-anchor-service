import express from 'express'
import asyncify from 'express-asyncify'
import { validate } from 'express-validation'
import { registerValidation, revokeValidation } from '../validators/did.js'
import { ClientFacingError } from '../utils/errorHandling.js'
import { Req, Res } from '../utils/reqres.js'
import { ConfigKey } from '../services/db.js'

const router = asyncify(express.Router())

/**
 * Register DIDs
 */
router.post('/', validate(registerValidation), async (req: Req, res: Res) => {
  const registrationEnabled = await req.customContext.db.getConfig(ConfigKey.RegistrationEnabled)
  if (!registrationEnabled) {
    return res.send({ message: 'We have reached capacity! We are not accepting new registrations at this time. Please try again later.'})
  }
  const data = await req.customContext.db.registerDIDs(req.body.email, req.body.otp, req.body.dids)
  if (data) {
    if (data.length > 0) {
      const keyData = data.map((didResult) => ({ user: didResult.email, apiKey: didResult.did }))
      const apiKeys = await req.customContext.gateway.createApiKeys(keyData)
      if (!apiKeys) {
        console.error('Failed to create api keys after creating dids!!')
      } else {
        return res.send(data)
      }
    }
  }
  throw new ClientFacingError('Could not register DIDs')
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
