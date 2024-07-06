import { test, describe, expect, beforeAll } from '@jest/globals'
import express, { Express } from 'express'
import { auth } from '../auth.middleware.js'
import supertest from 'supertest'
import { DID } from 'dids'
import { Ed25519Provider } from 'key-did-provider-ed25519'
import KeyDIDResolver from 'key-did-resolver'
import { CARFactory } from 'cartonne'
import bodyParser from 'body-parser'
import { logger } from '../../logger/index.js'

const carFactory = new CARFactory()

async function createDidKey(
  seed: Uint8Array = crypto.getRandomValues(new Uint8Array(32))
): Promise<DID> {
  const did = new DID({
    provider: new Ed25519Provider(seed),
    resolver: KeyDIDResolver.getResolver(),
  })
  await did.authenticate()
  return did
}

async function makeJWS(did: DID, payload: object): Promise<string> {
  const dagJWS = await did.createJWS(payload)
  const signature = dagJWS.signatures[0]
  if (!signature) throw new Error(`No signature`)
  return `${signature.protected}.${dagJWS.payload}.${signature.signature}`
}

describe('Authorization header: strict', () => {
  let app: Express
  let did: DID
  let disallowedDID: DID

  beforeAll(async () => {
    did = await createDidKey()
    disallowedDID = await createDidKey()
    app = express().use(express.json())
    app.use(bodyParser.raw({ inflate: true, type: 'application/vnd.ipld.car', limit: '1mb' }))
    app.use(bodyParser.json({ type: 'application/json' }))
    app.use(bodyParser.urlencoded({ extended: true, type: 'application/x-www-form-urlencoded' }))
    app.use(
      auth({
        allowedDIDs: new Set([did.id]),
        isRelaxed: false,
        logger: logger,
      })
    )
    app.post('/', (req, res) => {
      res.json({ hello: 'world' })
    })
  })

  test('allowed DID, valid digest', async () => {
    const carFile = carFactory.build()
    const cid = carFile.put({ hello: 'world' }, { isRoot: true })
    const jws = await makeJWS(did, { nonce: '1234567890', digest: cid.toString() })
    const response = await supertest(app)
      .post('/')
      .set('Content-Type', 'application/vnd.ipld.car')
      .set('Authorization', `Bearer ${jws}`)
      .send(Buffer.from(carFile.bytes)) // Supertest quirk
    expect(response.status).toBe(200)
  })
  test('allowed DID, invalid digest', async () => {
    const carFile = carFactory.build()
    const jws = await makeJWS(did, { nonce: '1234567890', digest: `Invalid` })
    const response = await supertest(app)
      .post('/')
      .set('Content-Type', 'application/vnd.ipld.car')
      .set('Authorization', `Bearer ${jws}`)
      .send(Buffer.from(carFile.bytes)) // Supertest quirk
    expect(response.status).toBe(403)
  })
  test('disallowed DID, valid digest', async () => {
    const carFile = carFactory.build()
    const cid = carFile.put({ hello: 'world' }, { isRoot: true })
    const jws = await makeJWS(disallowedDID, { nonce: '1234567890', digest: cid.toString() })
    const response = await supertest(app)
      .post('/')
      .set('Content-Type', 'application/vnd.ipld.car')
      .set('Authorization', `Bearer ${jws}`)
      .send(Buffer.from(carFile.bytes)) // Supertest quirk
    expect(response.status).toBe(403)
  })
  test('disallowed DID, invalid digest', async () => {
    const carFile = carFactory.build()
    const jws = await makeJWS(disallowedDID, { nonce: '1234567890', digest: `Invalid` })
    const response = await supertest(app)
      .post('/')
      .set('Content-Type', 'application/vnd.ipld.car')
      .set('Authorization', `Bearer ${jws}`)
      .send(Buffer.from(carFile.bytes)) // Supertest quirk
    expect(response.status).toBe(403)
  })
})

describe('Authorization header: relaxed', () => {
  let app: Express
  let disallowedDID: DID
  let did: DID

  beforeAll(async () => {
    disallowedDID = await createDidKey()
    did = await createDidKey()
    app = express().use(express.json())
    app.use(bodyParser.raw({ inflate: true, type: 'application/vnd.ipld.car', limit: '1mb' }))
    app.use(bodyParser.json({ type: 'application/json' }))
    app.use(bodyParser.urlencoded({ extended: true, type: 'application/x-www-form-urlencoded' }))
    app.use(
      auth({
        allowedDIDs: new Set([did.id]),
        isRelaxed: true,
        logger: logger,
      })
    )
    app.post('/', (req, res) => {
      res.json({ hello: 'world' })
    })
  })

  test('disallowed DID, valid digest', async () => {
    const carFile = carFactory.build()
    const cid = carFile.put({ hello: 'world' }, { isRoot: true })
    const jws = await makeJWS(disallowedDID, { nonce: '1234567890', digest: cid.toString() })
    const response = await supertest(app)
      .post('/')
      .set('Content-Type', 'application/vnd.ipld.car')
      .set('Authorization', `Bearer ${jws}`)
      .send(Buffer.from(carFile.bytes)) // Supertest quirk
    expect(response.status).toBe(200)
  })
  test('disallowed DID, invalid digest', async () => {
    const carFile = carFactory.build()
    const jws = await makeJWS(disallowedDID, { nonce: '1234567890', digest: `Invalid` })
    const response = await supertest(app)
      .post('/')
      .set('Content-Type', 'application/vnd.ipld.car')
      .set('Authorization', `Bearer ${jws}`)
      .send(Buffer.from(carFile.bytes)) // Supertest quirk
    expect(response.status).toBe(403)
  })
})

describe('Auth lambda', () => {
  let app: Express
  let did: DID

  beforeAll(async () => {
    did = await createDidKey()
    app = express().use(express.json())
    app.use(bodyParser.raw({ inflate: true, type: 'application/vnd.ipld.car', limit: '1mb' }))
    app.use(bodyParser.json({ type: 'application/json' }))
    app.use(bodyParser.urlencoded({ extended: true, type: 'application/x-www-form-urlencoded' }))
    app.use(
      auth({
        allowedDIDs: new Set(),
        isRelaxed: false,
        logger: logger,
      })
    )
    app.post('/', (req, res) => {
      res.json({ hello: 'world' })
    })
  })

  test('valid digest', async () => {
    const carFile = carFactory.build()
    const cid = carFile.put({ hello: 'world' }, { isRoot: true })
    const response = await supertest(app)
      .post('/')
      .set('Content-Type', 'application/vnd.ipld.car')
      .set('did', did.id)
      .set('digest', cid.toString())
      .send(Buffer.from(carFile.bytes)) // Supertest quirk
    expect(response.status).toBe(200)
  })
  test('invalid digest', async () => {
    const carFile = carFactory.build()
    const response = await supertest(app)
      .post('/')
      .set('Content-Type', 'application/vnd.ipld.car')
      .set('did', did.id)
      .set('digest', 'INVALID')
      .send(Buffer.from(carFile.bytes)) // Supertest quirk
    expect(response.status).toBe(403)
  })
})

describe('empty allowed dids list', () => {
  let app: Express
  let did: DID

  beforeAll(async () => {
    did = await createDidKey()
    app = express().use(express.json())
    app.use(bodyParser.raw({ inflate: true, type: 'application/vnd.ipld.car', limit: '1mb' }))
    app.use(bodyParser.json({ type: 'application/json' }))
    app.use(bodyParser.urlencoded({ extended: true, type: 'application/x-www-form-urlencoded' }))
    app.use(
      auth({
        allowedDIDs: new Set(),
        isRelaxed: false,
        logger: logger,
      })
    )
    app.post('/', (req, res) => {
      res.json({ hello: 'world' })
    })
  })

  test('pass Authorization header check', async () => {
    const carFile = carFactory.build()
    const cid = carFile.put({ hello: 'world' }, { isRoot: true })
    const jws = await makeJWS(did, { nonce: '1234567890', digest: cid.toString() })
    const response = await supertest(app)
      .post('/')
      .set('Content-Type', 'application/vnd.ipld.car')
      .set('Authorization', `Bearer ${jws}`)
      .send(Buffer.from(carFile.bytes)) // Supertest quirk
    expect(response.status).toBe(200)
  })
  test('use Auth Lambda check: ok', async () => {
    const carFile = carFactory.build()
    const cid = carFile.put({ hello: 'world' }, { isRoot: true })
    const response = await supertest(app)
      .post('/')
      .set('Content-Type', 'application/vnd.ipld.car')
      .set('did', did.id)
      .set('digest', cid.toString())
      .send(Buffer.from(carFile.bytes)) // Supertest quirk
    expect(response.status).toBe(200)
  })
  test('use Auth Lambda check: invalid digest', async () => {
    const carFile = carFactory.build()
    const response = await supertest(app)
      .post('/')
      .set('Content-Type', 'application/vnd.ipld.car')
      .set('did', did.id)
      .set('digest', 'INVALID')
      .send(Buffer.from(carFile.bytes)) // Supertest quirk
    expect(response.status).toBe(403)
  })
})
