import express from 'express'
import asyncify from 'express-asyncify'
import { validate } from 'express-validation'
import { registerValidation, revokeValidation } from '../validators/did.js'
import { ClientFacingError } from '../utils/errorHandling.js'
import { Req, Res } from '../utils/reqres.js'
import { ConfigKey } from '../services/db.js'
import { checkUserIsAdmin } from '../utils/auth.js'
import { METRIC_NAMES } from '../utils/metrics.js'

const router = asyncify(express.Router())

/**
 * Register DIDs
 */
router.post('/', validate(registerValidation), async (req: Req, res: Res) => {
  let userIsAdmin = false
  if (req.headers.authorization) {
    userIsAdmin = checkUserIsAdmin(req.headers.authorization)
  }

  if (!userIsAdmin) {
    const valueOnly = true
    const registrationEnabled = await req.customContext.db.getConfig(ConfigKey.RegistrationEnabled, valueOnly)
    if (registrationEnabled == false) {
      await req.customContext.metrics.count(METRIC_NAMES.register, 1, {'result': 'refused'})
      return res.send({ message: 'We have reached capacity! We are not accepting new registrations at this time. Please try again later.'})
    }
  }

  const skipOTP = userIsAdmin
  let data
  try {
    data = await req.customContext.db.registerDIDs(req.body.email, req.body.otp, req.body.dids, skipOTP)
  } catch (err) {
    console.error(err)
    await req.customContext.metrics.count(METRIC_NAMES.register, 1, {'result': 'register_error'})
    throw new ClientFacingError(`Could not register DIDs: ${err.message}`)
  }

  if (! data || data.length == 0) {
    await req.customContext.metrics.count(METRIC_NAMES.register, 1, {'result': 'no_data'})
    throw new ClientFacingError('No new DIDs registered')
  }

  const keyData = data.map((didResult) => ({ user: didResult.email, apiKey: didResult.did }))
  try {
    await req.customContext.gateway.createApiKeys(keyData)
    await req.customContext.metrics.count(METRIC_NAMES.register, 1, {'result': 'success'})
  } catch (err) {
    console.error(err)
    await req.customContext.metrics.count(METRIC_NAMES.register, 1, {'result': 'gateway_error'})
    throw new ClientFacingError(`Could not register DIDs: ${err.message}`)
  }
  return res.send(data)
})

/**
 * Revoke DID
 */
router.patch('/:did', validate(revokeValidation), async (req: Req, res: Res) => {
  const data = await req.customContext.db.revokeDID(req.body.email, req.body.otp, req.params.did)
  if (data) {
    try {
      await req.customContext.gateway.disableApiKey(data.email, data.did)
    } catch (err) {
      console.error(err)
    }
    await req.customContext.metrics.count(METRIC_NAMES.revoke, 1, {'result': 'success'})
    return res.send(data)
  }
  await req.customContext.metrics.count(METRIC_NAMES.revoke, 1, {'result': 'error'})
  throw new ClientFacingError('Could not revoke DID')
})

export const did = router
