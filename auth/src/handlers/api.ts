import bodyParser from 'body-parser'
import express from 'express'
import serverless from 'serverless-http'
import * as routes from '../routes/index.js'
import { DynamoDB } from "../utils/dynamodb.js"

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
  res.send({ error: err.message })
}
 
export const handler = async (event, context) => {
  await db.init()
  return serverless(app)(event, context)
}
