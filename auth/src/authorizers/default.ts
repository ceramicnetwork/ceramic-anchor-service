import { APIGatewayAuthorizerEvent, APIGatewayEvent, APIGatewayRequestAuthorizerEvent } from 'aws-lambda'
import { EC2 } from 'aws-sdk'
import { VerifyJWSResult } from 'dids'
import { Joi } from 'express-validation'
import { DynamoDB } from '../services/aws/dynamodb.js'
import { DIDStatus } from '../services/db.js'
import { parseSignature } from '../utils/did.js'
import { generatePolicy } from '../utils/iam.js'
import { authBearerValidation } from '../validators/did.js'

const schema = Joi.object({
  authorization: authBearerValidation.optional()
})

export const handler = async (event: APIGatewayRequestAuthorizerEvent, context, callback) => {
  console.log(event)
  console.log(context)

  const { error, value } = schema.validate({ authorization: event.headers?.Authorization });
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
    if (!did) {
      console.error('Missing did')
    } else {
      const createTableIfNotExists = false
      const db = new DynamoDB(createTableIfNotExists)
      const data = await db.getDIDRegistration(did, DIDStatus.Active)
      if (data && result.payload) {
        if (result.payload.nonce > data.nonce) {
          const success = await db.updateNonce(did, data.nonce)
          if (!success) {
            console.error('Failed to update nonce')
          } else {
            return callback(null, generatePolicy(did, {effect: 'Allow', resource: event.methodArn}, did))
          }
        } else {
          console.error(`Nonce (${result.payload.nonce}) is too small`)
        }
      } else {
        console.error('Missing data or payload')
      }
    }
  }

  return callback('Unauthorized')
}
