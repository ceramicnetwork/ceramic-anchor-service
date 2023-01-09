import { Joi } from 'express-validation'
import { didRegex } from '../utils/did.js'
import { authBearerRegex } from '../utils/reqres.js'

export const authBearerValidation = Joi.string().regex(authBearerRegex)

export const registerValidation = {
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

export const getNonceValidation = {
    headers: Joi.object({
        authorization: authBearerValidation.required(),
    }).unknown(true),
    params: Joi.object({
        did: Joi.string()
          .regex(didRegex)
          .required()
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

