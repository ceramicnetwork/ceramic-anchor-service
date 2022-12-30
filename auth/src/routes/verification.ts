import express from 'express'
import asyncify from 'express-asyncify'
import { Database } from '../services/db'
import { checkValidEmail, EmailService } from '../services/email'
import { ClientFacingError } from '../utils/errorHandling'
import { Req, Res } from '../utils/reqres'

const router = asyncify(express.Router())

/**
 * Get an OTP sent to email
 */
router.post('/', async (req: Req, res: Res) => {
    const body = req.body
    if (!body) throw new ClientFacingError('Missing body')
    if (!checkValidEmail(body.email)) throw new ClientFacingError('Invalid email')
    const validEmail = body.email
    const code = await req.customContext.db.createEmailVerificationCode(validEmail)
    if (code) {
      await req.customContext.email.sendVerificationCode(validEmail, code)
      return res.send({message: 'Please check your email for your verification code.'})
    }
    throw new ClientFacingError('Unavailable. Try again later.')
})

export const verification = router
