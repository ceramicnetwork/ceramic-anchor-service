import { Joi } from 'express-validation'
import { didRegex } from '../utils/did.js'

export const registerValidation = {
  body: Joi.object({
    email: Joi.string()
      .email()
      .required(),
    dids: Joi.array()
      .unique()
      .items(
        Joi.string()
        .regex(didRegex)
      )
      .required(),
    otp: Joi.string()
      .required(),
  }),
}

export const getNonceValidation = {
    headers: Joi.object({
        Authorization: Joi.string()
    }),
    params: Joi.object({
        did: Joi.string()
          .regex(didRegex)
          .required()
    }),
}
