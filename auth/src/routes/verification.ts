import express from 'express'
import asyncify from 'express-asyncify'
import { validate } from 'express-validation'
import { ClientFacingError } from '../utils/errorHandling.js'
import { Req, Res } from '../utils/reqres.js'
import { verifyValidation } from '../validators/verification.js'

const router = asyncify(express.Router())

/**
 * Get an OTP sent to email
 */
router.post('/', validate(verifyValidation), async (req: Req, res: Res) => {
    const code = await req.customContext.db.createEmailVerificationCode(req.body.email)
    if (code) {
      await req.customContext.email.sendVerificationCode(req.body.email, code)
      return res.send({message: 'Please check your email for your verification code.'})
    }
    throw new ClientFacingError('Unavailable. Try again later.')
})

export const verification = router
