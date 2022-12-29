import express from 'express'
import asyncify from 'express-asyncify'
import { Database } from '../utils/db'
import { ClientFacingError } from '../utils/errorHandling'

const router = asyncify(express.Router())

/**
 * Get an OTP sent to email
 */
router.post('/', async (req, res) => {
    const body = req.body
    if (!body) throw Error('Missing body')
    const validEmail = body.email ?? undefined
    if (validEmail) {
        const data = await (req.customContext.db as Database).createEmailVerificationCode(validEmail)
        const success = data && true
        if (success) {
          return res.send({success})
        }
    }
    throw new ClientFacingError('Unavailable. Try again later.')
})

export const verification = router
