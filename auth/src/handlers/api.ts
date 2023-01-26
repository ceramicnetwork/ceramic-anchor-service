import bodyParser from 'body-parser'
import express from 'express'
import { ValidationError } from 'express-validation'
import serverless from 'serverless-http'

import * as routes from '../routes/index.js'
import { ApiGateway } from '../services/aws/apiGateway.js'
import { DynamoDB } from '../services/aws/dynamodb.js'
import { SESService } from '../services/aws/ses.js'
import { ClientFacingError } from '../utils/errorHandling.js'
import { CustomContext, httpMethods } from '../utils/reqres.js'
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";

export const API_ENDPOINT = '/api/v0/auth'

const app = express()
const createTableIfNotExists = true
const db = new DynamoDB(createTableIfNotExists)
const email = new SESService()
const gateway = new ApiGateway()
const cwclient = new CloudWatchClient({})

// just to test for now
const cmd = new PutMetricDataCommand({'MetricName': 'ApiGatewayHello',
                                      'Value': 1 })
const resp = await cwclient.send(cmd)
console.log(resp)

app.use(bodyParser.json())
app.use(parseAsJson)
function parseAsJson(req, res, next) {
  switch (req.method) {
    case httpMethods.POST:
    case httpMethods.PUT:
    case httpMethods.PATCH:
      if (req.body) {
        req.body = JSON.parse(req.apiGateway.event.body)
      }
      break
    default:
      break
  }
  next()
}
app.use(customContext)
function customContext(req, res, next) {
  const context: CustomContext = {
    db,
    email,
    gateway
  }
  req.customContext = context
  next()
}

app.use(API_ENDPOINT + '/config', routes.config)
app.use(API_ENDPOINT + '/did', routes.did)
app.use(API_ENDPOINT + '/verification', routes.verification)

// Handle 404s under all other routes
app.use((req, res, next) => {
  res.status(404).send({error: 'Not found'})
})

// Handle errors last
app.use(errorHandler)
function errorHandler (err, req, res, next) {
  if (res.headersSent) {
    return next(err)
  }
  let error = 'Error'
  if (err instanceof ValidationError) {
    console.error(err.details)
    error = err.message
  } else if (err instanceof ClientFacingError) {
    error = err.message
  } else {
    console.error(err)
  }
  res.status(400).send({ error })
}
 
export const handler = async (event, context) => {
  await db.init()
  await email.init()
  await gateway.init()
  return serverless(app)(event, context)
}
