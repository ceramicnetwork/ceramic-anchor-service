import { Networks } from '@ceramicnetwork/common'
import { APIGatewayRequestAuthorizerEvent } from 'aws-lambda'
import { VerifyJWSResult } from 'dids'
import { Joi } from 'express-validation'
import { DynamoDB } from '../services/aws/dynamodb.js'
import { didRegex, parseSignature } from '../utils/did.js'
import { generatePolicy } from '../utils/iam.js'
import { authBearerValidation, nonceValidation } from '../validators/did.js'
import { ALLOWED_IP_ADDRESSES } from './ipAllowlist.js'

const authSchema = Joi.object({
  authorization: authBearerValidation.optional()
})

const allowRegisteredDIDSchema = Joi.object({
  did: Joi.string().regex(didRegex).required(),
  nonce: nonceValidation.required()
})

export const handler = async (event: APIGatewayRequestAuthorizerEvent, context, callback) => {
  console.log(event)
  console.log(context)

  if (process.env.CERAMIC_NETWORK == Networks.TESTNET_CLAY) {
    return allowAll(event, callback)
  }

  const { error, value } = authSchema.validate({ authorization: event.headers?.Authorization });
  if (error) {
    console.error(error)
    return callback('Unauthorized')
  }

  if (!value.authorization) {
    return await allowPermissionedIPAddress(event, callback)
  }

  const jws = value.authorization.split('Bearer ')[1]
  if (jws) {
    return await allowRegisteredDID(event, callback, jws)
  }

  return callback('Unauthorized')
}

function allowAll(event: APIGatewayRequestAuthorizerEvent, callback: any): any {
  const ip = event.requestContext.identity.sourceIp
  return callback(null, generatePolicy(ip, {effect: 'Allow', resource: event.methodArn }))
}

async function allowPermissionedIPAddress(event: APIGatewayRequestAuthorizerEvent, callback: any): Promise<any> {
    const ip = event.requestContext.identity.sourceIp
    console.log('ip', ip)
    if (ALLOWED_IP_ADDRESSES[ip]) {
      return callback(null, generatePolicy(ip, {effect: 'Allow', resource: event.methodArn}, ip))
    } else {
      console.error('Not in allowed IP address list')
      return callback('Unauthorized')
    }
}

async function allowRegisteredDID(event: APIGatewayRequestAuthorizerEvent, callback, jws: string): Promise<any> {
  let result: VerifyJWSResult | undefined
  try {
    result = await parseSignature(jws)
  } catch (err) {
    console.error(err)
    return callback('Unauthorized')
  }

  if (result) {
    const did = result.didResolutionResult.didDocument?.id
    const nonce = result.payload?.nonce
    const digest = result.payload?.digest
    if (!did) {
      console.error('Missing did')
    } else if (!nonce) {
      console.error('Missing nonce')
    } else {
      const { error, value } = allowRegisteredDIDSchema.validate({ did, nonce });
      if (error) {
        console.error(error.details)
      } else {
        const createTableIfNotExists = false
        const db = new DynamoDB(createTableIfNotExists)
        const data = await db.addNonce(did, nonce)
        if (data) {
          if (data.did == did && data.nonce == nonce) {
            const context = {
              "did": did,
              "digest": digest
            }
            return callback(null, generatePolicy(did, {effect: 'Allow', resource: event.methodArn}, did, context))
          }
        }
      }
    }
  }

  return callback('Unauthorized')
}
