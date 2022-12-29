import express from 'express'
import asyncify from 'express-asyncify'
import { Database } from '../utils/db'

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
        if (data) {
          return res.send(data)
        }
    }
    throw Error('Could not register DID')
})

export const verification = router
