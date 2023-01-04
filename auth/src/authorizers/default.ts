import { Joi } from 'express-validation'
import { parseSignature } from '../utils/did.js'
import { authBearerValidation } from '../validators/did.js'

export const handler = async (event, context) => {
  console.log(event)
  console.log(context)
  // TODO: allow ip addresses on allowlist
  const authorization: string = event.headers.Authorization
  const schema = Joi.object({
    authorization: authBearerValidation
  })
  const { error, value } = schema.validate({ authorization });
  const jws = (value as string).split('Bearer ')[1]
  const {kid, payload, didResolutionResult } = await parseSignature(jws)
  const did = didResolutionResult.didDocument?.id
  console.log(did)

  // TODO: check did is registered
  // if so, update nonce
  // if not, throw

  console.error(error)
  console.log(value)


  // TODO: return did as api key

    // const [, /* type */ credential] = event.authorizationToken.split(' ')
  
    // // if (credential === '4674cc54-bd05-11e7-abc4-cec278b6b50a') {
    // //   return generatePolicy('user123', 'Allow', event.methodArn)
    // // }
  
    // // if (credential === '4674cc54-bd05-11e7-abc4-cec278b6b50b') {
    // //   return generatePolicy('user123', 'Deny', event.methodArn)
    // // }
  
    // throw new Error('Unauthorized')
  }