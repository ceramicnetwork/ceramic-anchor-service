import 'reflect-metadata'
import 'dotenv/config'
import {
  jest,
  beforeAll,
  beforeEach,
  describe,
  afterEach,
  afterAll,
  expect,
  test,
} from '@jest/globals'
import { CeramicDaemon, DaemonConfig } from '@ceramicnetwork/cli'
import { Ceramic } from '@ceramicnetwork/core'
import { AnchorStatus, fetchJson, IpfsApi, Stream } from '@ceramicnetwork/common'
import { ServiceMetrics as Metrics } from '@ceramicnetwork/observability'

import * as Ctl from 'ipfsd-ctl'
import * as ipfsClient from 'ipfs-http-client'
import { path } from 'go-ipfs'

import express from 'express'
import { makeGanache } from './make-ganache.util.js'
import type { GanacheServer } from './make-ganache.util.js'
import tmp from 'tmp-promise'
import getPort from 'get-port'
import type { Knex } from 'knex'
import { clearTables, createDbConnection } from '../db-connection.js'
import { CeramicAnchorApp } from '../app.js'
import { config } from 'node-config-ts'
import cloneDeep from 'lodash.clonedeep'
import { TileDocument } from '@ceramicnetwork/stream-tile'
import { filter } from 'rxjs/operators'
import { firstValueFrom, timeout, throwError } from 'rxjs'
import { DID } from 'dids'
import { Ed25519Provider } from 'key-did-provider-ed25519'
import { randomBytes } from '@stablelib/random'
import * as KeyDidResolver from 'key-did-resolver'
import { Utils } from '../utils.js'
import { RequestStatus } from '../models/request.js'
import { AnchorService } from '../services/anchor-service.js'
import { METRIC_NAMES } from '../settings.js'
import { Server } from 'http'
import type { Injector } from 'typed-inject'
import { createInjector } from 'typed-inject'
import { teeDbConnection } from './tee-db-connection.util.js'

process.env.NODE_ENV = 'test'

const randomNumber = Math.floor(Math.random() * 10000)
const TOPIC = `/ceramic/local/${randomNumber}`

const ipfsHttpModule = {
  create: (ipfsEndpoint: string) => {
    return ipfsClient.create({
      url: ipfsEndpoint,
    })
  },
}

const createFactory = () => {
  return Ctl.createFactory(
    {
      ipfsHttpModule,
      ipfsOptions: {
        repoAutoMigrate: true,
      },
    },
    {
      go: {
        ipfsBin: path(),
      },
    }
  )
}

/**
 * Create an IPFS instance
 */
async function createIPFS(apiPort?: number): Promise<IpfsApi> {
  const tmpFolder = await tmp.dir({ unsafeCleanup: true })
  const swarmPort = await getPort()
  const effectiveApiPort = apiPort || (await getPort())
  const gatewayPort = await getPort()

  const config = {
    repo: `${tmpFolder.path}/ipfs${swarmPort}/`,
    config: {
      Addresses: {
        Swarm: [`/ip4/127.0.0.1/tcp/${swarmPort}`],
        Gateway: `/ip4/127.0.0.1/tcp/${gatewayPort}`,
        API: `/ip4/127.0.0.1/tcp/${effectiveApiPort}`,
      },
      Pubsub: {
        Enabled: true,
        SeenMessagesTTL: '10m',
      },
      Discovery: { DNS: { Enabled: false }, webRTCStar: { Enabled: false } },
      Bootstrap: [],
    },
  }

  const ipfsd = await createFactory().spawn({
    type: 'go',
    ipfsOptions: config,
    disposable: true,
  })

  console.log(`starting IPFS node with config: ${JSON.stringify(config, null, 2)}`)
  const started = await ipfsd.start()
  return started.api
}

async function swarmConnect(a: IpfsApi, b: IpfsApi) {
  const addressB = (await b.id()).addresses[0]
  await a.swarm.connect(addressB)
}

async function makeCeramicCore(
  ipfs: IpfsApi,
  anchorServiceUrl: string,
  ethereumRpcUrl: URL | undefined
): Promise<Ceramic> {
  const tmpFolder = await tmp.dir({ unsafeCleanup: true })
  const ceramic = await Ceramic.create(ipfs, {
    networkName: 'local',
    pubsubTopic: TOPIC,
    stateStoreDirectory: tmpFolder.path,
    anchorServiceUrl,
    // TODO CDB-2317 Remove `indexing` config when Ceramic Core allows that
    indexing: {
      db: 'TODO',
      allowQueriesBeforeHistoricalSync: false,
      disableComposedb: true,
      enableHistoricalSync: false,
    },
    ethereumRpcUrl: ethereumRpcUrl?.href,
  })
  ceramic.did = makeDID()
  await ceramic.did.authenticate()
  return ceramic
}

function makeDID(): DID {
  const seed = randomBytes(32)
  const provider = new Ed25519Provider(seed)
  const resolver = KeyDidResolver.getResolver()
  return new DID({ provider, resolver })
}

class FauxAnchorLauncher {
  port: number
  server: Server
  start(port: number) {
    const app = express()
    app.all('/', (req, res) => {
      res.send({ status: 'success' })
    })
    this.server = app.listen(port, () => {
      console.log(`Listening on port ${port}`)
    })
  }
  stop() {
    return new Promise((resolve) => this.server.close(resolve))
  }
}

function makeAnchorLauncher(port: number): FauxAnchorLauncher {
  const launcher = new FauxAnchorLauncher()
  launcher.start(port)
  return launcher
}

interface MinimalCASConfig {
  ipfsPort: number
  ceramicPort: number
  ganachePort: number
  mode: string
  port: number
  useSmartContractAnchors: boolean
}

async function makeCAS(
  container: Injector,
  dbConnection: Knex,
  minConfig: MinimalCASConfig
): Promise<CeramicAnchorApp> {
  const configCopy = cloneDeep(config)
  configCopy.mode = minConfig.mode
  configCopy.port = minConfig.port
  configCopy.anchorControllerEnabled = true
  configCopy.merkleDepthLimit = 0
  configCopy.minStreamCount = 1
  configCopy.ipfsConfig.url = `http://localhost:${minConfig.ipfsPort}`
  configCopy.ipfsConfig.pubsubTopic = TOPIC
  configCopy.ceramic.apiUrl = `http://localhost:${minConfig.ceramicPort}`
  configCopy.blockchain.connectors.ethereum.network = 'ganache'
  configCopy.blockchain.connectors.ethereum.rpc.port = String(minConfig.ganachePort)
  configCopy.useSmartContractAnchors = minConfig.useSmartContractAnchors
  configCopy.carStorage = {
    mode: 'inmemory',
  }
  return new CeramicAnchorApp(
    container.provideValue('config', configCopy).provideValue('dbConnection', dbConnection)
  )
}

async function anchorUpdate(
  stream: Stream,
  anchorApp: CeramicAnchorApp,
  anchorService: AnchorService
): Promise<void> {
  // The anchor request is not guaranteed to already have been sent to the CAS when the create/update
  // promise resolves, so we wait a bit to give the ceramic node time to actually send the request
  // before triggering the anchor.
  // TODO(js-ceramic #1919): Remove this once Ceramic won't return from a request that makes an
  // anchor without having already made the anchor request against the CAS.
  await Utils.delay(5000)
  await anchorService.emitAnchorEventIfReady()
  await anchorApp.anchor()
  await waitForAnchor(stream)
}

async function waitForAnchor(stream: Stream, timeoutMS = 30 * 1000): Promise<void> {
  await firstValueFrom(
    stream.pipe(
      filter((state) => [AnchorStatus.ANCHORED, AnchorStatus.FAILED].includes(state.anchorStatus)),
      timeout({
        each: timeoutMS,
        with: () =>
          throwError(
            () => new Error(`Timeout waiting for stream ${stream.id.toString()} to become anchored`)
          ),
      })
    )
  )
}

describe('Ceramic Integration Test', () => {
  jest.setTimeout(60 * 1000 * 10)

  let ipfsApiPort1: number
  let ipfsApiPort2: number

  let ipfs1: IpfsApi // Used by CAS1 directly
  let ipfs2: IpfsApi // Used by CAS2 directly
  let ipfs3: IpfsApi // Used by CAS1 ceramic
  let ipfs4: IpfsApi // Used by CAS2 ceramic
  let ipfs5: IpfsApi // Used by main ceramic 1
  let ipfs6: IpfsApi // Used by main ceramic 2

  // let ipfsServer1: HttpApi
  // let ipfsServer2: HttpApi

  let casCeramic1: Ceramic // Ceramic node used internally by CAS1
  let casCeramic2: Ceramic // Ceramic node used internally by CAS2
  let ceramic1: Ceramic // First main Ceramic node used by the tests
  let ceramic2: Ceramic // Second main Ceramic node used by the tests

  let daemon1: CeramicDaemon // CAS1 Ceramic http server
  let daemon2: CeramicDaemon // CAS2 Ceramic http server

  let dbConnection1: Knex
  let dbConnection2: Knex

  let casPort1: number
  let cas1: CeramicAnchorApp
  let anchorService1: AnchorService
  let cas2: CeramicAnchorApp
  let anchorService2: AnchorService

  let ganacheServer: GanacheServer
  let anchorLauncher: FauxAnchorLauncher

  beforeAll(async () => {
    ipfsApiPort1 = await getPort()
    ipfsApiPort2 = await getPort()
    ;[ipfs1, ipfs2, ipfs3, ipfs4, ipfs5, ipfs6] = await Promise.all([
      createIPFS(ipfsApiPort1),
      createIPFS(ipfsApiPort2),
      createIPFS(),
      createIPFS(),
      createIPFS(),
      createIPFS(),
    ])

    // ipfsServer1 = new HttpApi(ipfs1)
    // await ipfsServer1.start()
    // ipfsServer2 = new HttpApi(ipfs2)
    // await ipfsServer2.start()

    // Now make sure all ipfs nodes are connected to all other ipfs nodes
    const ipfsNodes = [ipfs1, ipfs2, ipfs3, ipfs4, ipfs5, ipfs6]
    for (const [i] of ipfsNodes.entries()) {
      for (const [j] of ipfsNodes.entries()) {
        if (i == j) {
          continue
        }
        await swarmConnect(ipfsNodes[i], ipfsNodes[j])
      }
    }

    // Start up Ganache
    ganacheServer = await makeGanache()

    // Start faux anchor launcher
    anchorLauncher = makeAnchorLauncher(8001)
  })

  beforeEach(async () => {
    await clearTables(dbConnection1)
    await clearTables(dbConnection2)
  })

  afterAll(async () => {
    // await Promise.all([ipfsServer1.stop(), ipfsServer2.stop()])
    await Promise.all([
      ipfs1.stop(),
      ipfs2.stop(),
      ipfs3.stop(),
      ipfs4.stop(),
      ipfs5.stop(),
      ipfs6.stop(),
    ])
    await ganacheServer.close()
    await anchorLauncher.stop()
  })

  describe('Using anchor version 1', () => {
    beforeAll(async () => {
      const useSmartContractAnchors = true

      // Start anchor services
      const daemonPort1 = await getPort()
      const daemonPort2 = await getPort()
      dbConnection1 = await createDbConnection()
      casPort1 = await getPort()

      cas1 = await makeCAS(createInjector(), dbConnection1, {
        mode: 'server',
        ipfsPort: ipfsApiPort1,
        ceramicPort: daemonPort1,
        ganachePort: ganacheServer.port,
        port: casPort1,
        useSmartContractAnchors,
      })
      await cas1.start()
      anchorService1 = cas1.container.resolve('anchorService')
      dbConnection2 = await teeDbConnection(dbConnection1)
      const casPort2 = await getPort()
      cas2 = await makeCAS(createInjector(), dbConnection2, {
        mode: 'server',
        ipfsPort: ipfsApiPort2,
        ceramicPort: daemonPort2,
        ganachePort: ganacheServer.port,
        port: casPort2,
        useSmartContractAnchors,
      })
      await cas2.start()
      anchorService2 = cas2.container.resolve('anchorService')

      // Make the Ceramic nodes that will be used by the CAS.
      ;[casCeramic1, casCeramic2] = await Promise.all([
        makeCeramicCore(ipfs3, `http://localhost:${casPort1}`, ganacheServer.url),
        makeCeramicCore(ipfs4, `http://localhost:${casPort2}`, ganacheServer.url),
      ])
      daemon1 = new CeramicDaemon(
        casCeramic1,
        DaemonConfig.fromObject({ 'http-api': { port: daemonPort1 } })
      )
      daemon2 = new CeramicDaemon(
        casCeramic1,
        DaemonConfig.fromObject({ 'http-api': { port: daemonPort2 } })
      )
      await daemon1.listen()
      await daemon2.listen()

      // Finally make the Ceramic nodes that will be used in the tests.
      ceramic1 = await makeCeramicCore(ipfs5, `http://localhost:${casPort1}`, ganacheServer.url)
      ceramic2 = await makeCeramicCore(ipfs6, `http://localhost:${casPort2}`, ganacheServer.url)

      // The two user-facing ceramic nodes need to have the same DID Provider so that they can modify
      // each others streams.
      const did = makeDID()
      await did.authenticate()
      ceramic1.did = did
      ceramic2.did = did
    })

    afterAll(async () => {
      cas1.stop()
      cas2.stop()
      await Promise.all([dbConnection1.destroy(), dbConnection2.destroy()])
      await Promise.all([daemon1.close(), daemon2.close()])
      await Promise.all([
        casCeramic1.close(),
        casCeramic2.close(),
        ceramic1.close(),
        ceramic2.close(),
      ])
    })

    beforeEach(async () => {
      console.log(`Starting test: ${expect.getState().currentTestName}`)
    })

    afterEach(async () => {
      console.log(`Finished test: ${expect.getState().currentTestName}`)
      jest.restoreAllMocks()
    })

    describe('Multiple CAS instances in same process works', () => {
      test(
        'Anchors on different CAS instances are independent',
        async () => {
          const doc1 = await TileDocument.create(ceramic1, { foo: 1 }, null, { anchor: true })
          const doc2 = await TileDocument.create(ceramic2, { foo: 1 }, null, { anchor: true })

          expect(doc1.state.anchorStatus).toEqual(AnchorStatus.PENDING)
          expect(doc2.state.anchorStatus).toEqual(AnchorStatus.PENDING)

          // Test that anchoring on CAS1 doesn't anchor requests made against CAS2
          await anchorUpdate(doc1, cas1, anchorService1)
          expect(doc1.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)
          expect(doc2.state.anchorStatus).toEqual(AnchorStatus.PENDING)

          // Now test that anchoring on CAS2 doesn't anchor requests made against CAS1
          await doc1.update({ foo: 2 }, null, { anchor: true })
          await anchorUpdate(doc2, cas2, anchorService2)
          expect(doc1.state.anchorStatus).toEqual(AnchorStatus.PENDING)
          expect(doc2.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)

          console.log('Test complete: Anchors on different CAS instances are independent')
        },
        60 * 1000 * 3
      )

      test(
        'Multiple anchors for same stream',
        async () => {
          const doc1 = await TileDocument.create(ceramic1, { foo: 1 }, null, { anchor: true })
          expect(doc1.state.anchorStatus).toEqual(AnchorStatus.PENDING)
          await anchorUpdate(doc1, cas1, anchorService1)
          expect(doc1.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)

          // Now that genesis commit has been anchored do an update and make sure anchoring works again
          await doc1.update({ foo: 2 }, null, { anchor: true })
          await anchorUpdate(doc1, cas1, anchorService1)
          expect(doc1.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)
          expect(doc1.content).toEqual({ foo: 2 })

          console.log('Test complete: Multiple anchors for same stream')
        },
        60 * 1000 * 3
      )

      test(
        'Multiple anchors in a batch',
        async () => {
          const doc1 = await TileDocument.create(ceramic1, { foo: 1 }, null, { anchor: true })
          const doc2 = await TileDocument.create(ceramic1, { foo: 2 }, null, { anchor: true })

          expect(doc1.state.anchorStatus).toEqual(AnchorStatus.PENDING)
          expect(doc2.state.anchorStatus).toEqual(AnchorStatus.PENDING)

          await anchorUpdate(doc1, cas1, anchorService1)
          expect(doc1.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)
          await waitForAnchor(doc2)
          expect(doc2.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)

          console.log('Test complete: Multiple anchors in a batch')
        },
        60 * 1000 * 3
      )
    })

    test('Metrics produced on anchors', async () => {
      jest.setTimeout(60 * 100 * 2)

      const metricsCountSpy = jest.spyOn(Metrics, 'count')

      const initialContent = { foo: 0 }
      const doc1 = await TileDocument.create(ceramic1, initialContent, null, { anchor: true })
      expect(doc1.state.anchorStatus).toEqual(AnchorStatus.PENDING)

      await anchorUpdate(doc1, cas1, anchorService1)

      expect(metricsCountSpy).toHaveBeenCalledWith(METRIC_NAMES.ANCHOR_SUCCESS, 1)

      console.log('Test complete: Metrics counts anchor attempts')
    })

    test.skip('Can retrieve completed request when the request CID was not the stream tip when anchored', async () => {
      const doc1 = await TileDocument.create(ceramic1, { foo: 1 }, null, { anchor: true })
      const originalTip = doc1.tip
      await doc1.update({ foo: 2 }, null, { anchor: true })
      const nextTip = doc1.tip

      expect(doc1.state.anchorStatus).toEqual(AnchorStatus.PENDING)

      await anchorUpdate(doc1, cas1, anchorService1)

      expect(doc1.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)

      const nextTipRequest = await fetchJson(
        `http://localhost:${casPort1}/api/v0/requests/${nextTip.toString()}`
      )
      expect(RequestStatus[nextTipRequest.status]).toEqual(RequestStatus.COMPLETED)

      const originalTipRequest = await fetchJson(
        `http://localhost:${casPort1}/api/v0/requests/${originalTip.toString()}`
      )
      expect(RequestStatus[originalTipRequest.status]).toEqual(RequestStatus.COMPLETED)
    })

    test('Can retreive completed request that was marked COMPLETE because its stream was already anchored', async () => {
      const doc1 = await TileDocument.create(ceramic1, { foo: 1 }, null, { anchor: false })
      const tipWithNoRequest = doc1.tip
      await doc1.update({ foo: 2 }, null, { anchor: true })
      const tipWithRequest = doc1.tip

      expect(doc1.state.anchorStatus).toEqual(AnchorStatus.PENDING)
      await anchorUpdate(doc1, cas1, anchorService1)
      expect(doc1.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)

      const tipWithRequestInfo = await fetchJson(
        `http://localhost:${casPort1}/api/v0/requests/${tipWithRequest.toString()}`
      )
      expect(RequestStatus[tipWithRequestInfo.status]).toEqual(RequestStatus.COMPLETED)

      await fetchJson(`http://localhost:${casPort1}/api/v0/requests`, {
        method: 'POST',
        body: {
          streamId: doc1.id.toString(),
          docId: doc1.id.toString(),
          cid: tipWithNoRequest.toString(),
        },
      })

      const tipWithNoRequestBeforeAnchorInfo = await fetchJson(
        `http://localhost:${casPort1}/api/v0/requests/${tipWithNoRequest.toString()}`
      )
      expect(RequestStatus[tipWithNoRequestBeforeAnchorInfo.status]).toEqual(RequestStatus.PENDING)

      await anchorService1.emitAnchorEventIfReady()
      await cas1.anchor()

      const tipWithNoRequestAfterAnchorInfo = await fetchJson(
        `http://localhost:${casPort1}/api/v0/requests/${tipWithNoRequest.toString()}`
      )
      expect(RequestStatus[tipWithNoRequestAfterAnchorInfo.status]).toEqual(RequestStatus.COMPLETED)
    })
  })
})
