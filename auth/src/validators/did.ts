import { Joi } from 'express-validation'
import { didRegex } from '../utils/did.js'
import { authBasicRegex, authBearerRegex } from '../utils/auth.js'

export const authBasicValidation = Joi.string().regex(authBasicRegex)
export const authBearerValidation = Joi.string().regex(authBearerRegex)
export const nonceValidation = Joi.string().uuid()

export const registerValidation = {
  header: Joi.object({
    authorization: Joi.string()
      .regex(authBasicRegex)
      .optional()
  }),
  body: Joi.object({
    email: Joi.string()
      .email()
      .required(),
    otp: Joi.string()
      .required(),
    dids: Joi.array()
      .unique()
      .items(
        Joi.string()
        .regex(didRegex)
      )
      .required(),
  }),
}

export const revokeValidation = {
  body: Joi.object({
    email: Joi.string()
      .email()
      .required(),
    otp: Joi.string()
      .required()
  }),
}

