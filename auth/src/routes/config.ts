import express from 'express'
import asyncify from 'express-asyncify'
import { validate } from 'express-validation'
import { ClientFacingError } from '../utils/errorHandling.js'
import { Req, Res } from '../utils/reqres.js'
import { checkUserIsAdmin } from '../utils/auth.js'
import {
  getKeysValidation,
  getValueValidation,
  putConfigValidation
} from '../validators/config.js'
import { ConfigKey, ConfigKeys } from '../services/db.js'

const router = asyncify(express.Router())

/**
 * Get configuration option keys
 */
router.get('/keys', validate(getKeysValidation), async (req: Req, res: Res) => {
  if (!checkUserIsAdmin(String(req.headers.authorization))) {
    throw new ClientFacingError('Unauthorized')
  }
  return res.send(ConfigKeys)
})

/**
 * Get configuration option value
 */
router.get('/key/:PK', validate(getValueValidation), async (req: Req, res: Res) => {
  if (!checkUserIsAdmin(String(req.headers.authorization))) {
    throw new ClientFacingError('Unauthorized')
  }
  const data = await req.customContext.db.getConfig(req.params.PK as ConfigKey)
  if (data) {
    return res.send(data)
  }
  throw new ClientFacingError('Failed')
})

/**
 * Update configuration options
 */
router.put('/', validate(putConfigValidation), async (req: Req, res: Res) => {
  if (!checkUserIsAdmin(String(req.headers.authorization))) {
    throw new ClientFacingError('Unauthorized')
  }
  const data = await req.customContext.db.updateConfig(req.body.PK, req.body.v)
  if (data) {
    return res.send(data)
  }
  throw new ClientFacingError('Failed')
})

export const config = router
