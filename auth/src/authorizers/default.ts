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

const dynamodbClient = new DynamoDB(false)

export const handler = async (event: APIGatewayRequestAuthorizerEvent, context, callback) => {
  console.log(event)
  console.log(context)

  if (process.env.CERAMIC_NETWORK == Networks.TESTNET_CLAY) {
    return allowAll(event, callback)
  }

  // Check for allowed IP addresses before checking the authorization header, but fall through if the IP address isn't
  // in the allow list.
  const [foundIp, res] = await allowPermissionedIPAddress(event, callback)
  if (foundIp) {
    return res
  }

  const { error, value } = authSchema.validate({ authorization: event.headers?.Authorization });
  if (error) {
    console.error(error)
    return callback('Unauthorized')
  }

  if (value?.authorization) {
    const jws = value.authorization.split('Bearer ')[1]
    if (jws) {
      return await allowRegisteredDID(event, callback, jws)
    } else {
      console.error('Missing jws')
    }
  } else {
    console.error('Missing Authorization header value')
  }

  return callback('Unauthorized')
}

function allowAll(event: APIGatewayRequestAuthorizerEvent, callback: any): any {
  const ip = event.requestContext.identity.sourceIp
  const context = {
    "sourceIp": ip
  }
  return callback(null, generatePolicy(ip, {effect: 'Allow', resource: event.methodArn }, ip, context))
}

async function allowPermissionedIPAddress(event: APIGatewayRequestAuthorizerEvent, callback: any): Promise<[boolean, any]> {
    const ip = event.requestContext.identity.sourceIp
    console.log('ip', ip)

    const context = {
      "sourceIp": ip
    }
    if (ALLOWED_IP_ADDRESSES[ip]) {
      return [true, callback(null, generatePolicy(ip, {effect: 'Allow', resource: event.methodArn}, ip, context))]
    } else {
      // Not an error, log and fall through.
      console.log('Not in allowed IP address list')
      return [false, null]
    }
}

async function allowRegisteredDID(event: APIGatewayRequestAuthorizerEvent, callback, jws: string): Promise<any> {
  const ip = event.requestContext.identity.sourceIp
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
        const data = await dynamodbClient.addNonce(did, nonce)
        if (data) {
          if (data.did == did && data.nonce == nonce) {
            const context = {
              "did": did,
              "digest": digest,
              "sourceIp": ip
            }
            return callback(null, generatePolicy(did, {effect: 'Allow', resource: event.methodArn}, did, context))
          }
        } else {
          console.error('No data returned from add nonce')
        }
      }
    }
  } else {
    console.error('Missing parse signature result')
  }

  return callback('Unauthorized')
}
