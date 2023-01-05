import bodyParser from 'body-parser'
import express from 'express'
import { ValidationError } from 'express-validation'
import serverless from 'serverless-http'

import * as routes from '../routes/index.js'
import { DynamoDB } from '../services/aws/dynamodb.js'
import { SESService } from '../services/aws/ses.js'
import { ClientFacingError } from '../utils/errorHandling.js'
import { CustomContext } from '../utils/reqres.js'

export const API_ENDPOINT = '/api/v0/auth'

const app = express()
const createTableIfNotExists = true
const db = new DynamoDB(createTableIfNotExists)
const email = new SESService()

app.use(bodyParser.json())
app.use(parseAsJson)
function parseAsJson(req, res, next) {
  if (req.method == 'POST') {
    if (req.body) {
      req.body = JSON.parse(req.apiGateway.event.body)
    }
  }
  next()
}
app.use(customContext)
function customContext(req, res, next) {
  const context: CustomContext = {
    db,
    email
  }
  req.customContext = context
  next()
}

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
    console.log(err)
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
  return serverless(app)(event, context)
}
