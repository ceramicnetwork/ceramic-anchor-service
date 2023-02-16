import { APIGatewayRequestAuthorizerEvent } from 'aws-lambda'
import { EC2 } from 'aws-sdk'
import { VerifyJWSResult } from 'dids'
import { Joi } from 'express-validation'
import { DynamoDB } from '../services/aws/dynamodb.js'
import { didRegex, parseSignature } from '../utils/did.js'
import { generatePolicy } from '../utils/iam.js'
import { authBearerValidation, nonceValidation } from '../validators/did.js'

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

async function allowPermissionedIPAddress(event: APIGatewayRequestAuthorizerEvent, callback: any): Promise<any> {
  const ec2 = new EC2({apiVersion: '2016-11-15'})
    const permissionedSecurityGroupIds = process.env.PERMISSIONED_SECURITY_GROUP_IDS?.split(' ') || []
    const ip = event.requestContext.identity.sourceIp
    console.log('ip', ip)
    const request = ec2.describeSecurityGroups({
      Filters: [{Name: 'ip-permission.cidr', Values: [`${ip}/32`] }],
      GroupIds: permissionedSecurityGroupIds
    })
    try {
      const data = await request.promise()
      console.log(data)
      if (!data.SecurityGroups) throw new Error('No security groups found with this IP')
      if (data.SecurityGroups.length < 1) throw new Error('No security groups found with this IP')
      return callback(null, generatePolicy(ip, {effect: 'Allow', resource: event.methodArn}, ip))
    } catch (err) {
      console.error(err)
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
    const body = result.payload?.body
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
              "bodyHash": body
            }
            return callback(null, generatePolicy(did, {effect: 'Allow', resource: event.methodArn}, did, context))
          }
        }
      }
    }
  }

  return callback('Unauthorized')
}
