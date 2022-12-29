import bodyParser from 'body-parser'
import express from 'express'
import serverless from 'serverless-http'
import * as routes from '../routes/index.js'
import { DynamoDB } from "../utils/dynamodb.js"
import { ClientFacingError } from '../utils/errorHandling.js'

export const API_ENDPOINT = '/api/v0/auth'

const app = express()
const createTableIfNotExists = true
const db = new DynamoDB(createTableIfNotExists)

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
  req.customContext = { db }
  next()
}

app.use(API_ENDPOINT + '/did', routes.did)
app.use(API_ENDPOINT + '/verification', routes.verification)

// VAL: Proxy all other routes and store nonce

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
  if (err instanceof ClientFacingError) {
    error = err.message
  } else {
    console.error(err)
  }
  res.send({ error })
}
 
export const handler = async (event, context) => {
  await db.init()
  return serverless(app)(event, context)
}
