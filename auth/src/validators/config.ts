import { Joi } from 'express-validation'
import { ConfigKey, ConfigKeys } from '../services/db.js'
import { authBasicRegex } from '../utils/auth.js'

export const getKeysValidation = {
  headers: Joi.object().keys({
    authorization: Joi.string()
      .regex(authBasicRegex)
      .required()
  }).unknown(true),
}

export const getValueValidation = {
  headers: Joi.object().keys({
    authorization: Joi.string()
      .regex(authBasicRegex)
      .required()
  }).unknown(true),
  params: Joi.object({
    PK: Joi.string()
      .valid(...ConfigKeys)
      .required()
  })
}

export const putConfigValidation = {
  headers: Joi.object().keys({
    authorization: Joi.string()
      .regex(authBasicRegex)
      .required()
  }).unknown(true),
  body: Joi.object({
    PK: Joi.string()
      .valid(...ConfigKeys)
      .required(),
    v: Joi.required()
  }),
}
