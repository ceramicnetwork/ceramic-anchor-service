import { Joi } from 'express-validation'

export const verifyValidation = {
    body: Joi.object({
        email: Joi.string()
          .email()
          .required()
    })
}
