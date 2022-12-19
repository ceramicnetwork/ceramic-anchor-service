import express from 'express'
import asyncify from 'express-asyncify'

const router = asyncify(express.Router())

/**
 * Register DID
 */
router.post('/', async (req, res) => {
    const body = req.body
    if (!body) throw Error('Missing body')
    // TODO: verify email
    const validEmail = body.email ?? undefined
    const validDID = body.did ?? undefined
    if (validEmail && validDID) {
        const data = await req.customContext.db.registerDID(validEmail, validDID)
        if (data) {
          return res.send(data)
        }
    }
    throw Error('Could not register DID')
})

/**
 * Get last recorded nonce
 */
router.get('/:did/nonce', async (req, res) => {
  // TODO: validate the did in the signature matches here
  const validDID = req.params.did ?? undefined
  if (validDID) {
    const nonce = await req.customContext.db.getNonce(validDID) ?? -1
    if (nonce >= 0) {
      return res.send({ nonce })
    }
  }
  throw Error('Could not retrieve nonce')
})

/**
 * Revoke DID
 */
router.delete('/:did', async (req, res) => {
  // VAL: if jws in header, update nonce and revoke
  // else: get email and verify otp before revoking
  const nonce = 0
  const validDID = req.params.did ?? undefined
  if (validDID) {
    const email = await req.customContext.db.getEmail(validDID)
    const success = await req.customContext.db.revokeDID(email, validDID, nonce)
    if (success) {
      return res.send({ message: 'Revoked DID' })
    }
  }
  throw Error('Could not revoke DID')
})

export const did = router
