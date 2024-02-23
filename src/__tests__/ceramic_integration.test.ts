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
import { CARFactory, type CAR } from 'cartonne'

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
  let ipfs3: IpfsApi // Used by main ceramic 1
  let ipfs4: IpfsApi // Used by main ceramic 2

  let ceramic1: Ceramic // First main Ceramic node used by the tests
  let ceramic2: Ceramic // Second main Ceramic node used by the tests

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
    ;[ipfs1, ipfs2, ipfs3, ipfs4] = await Promise.all([
      createIPFS(ipfsApiPort1),
      createIPFS(ipfsApiPort2),
      createIPFS(),
      createIPFS(),
    ])

    // Now make sure all ipfs nodes are connected to all other ipfs nodes
    const ipfsNodes = [ipfs1, ipfs2, ipfs3, ipfs4]
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
    await Promise.all([ipfs1.stop(), ipfs2.stop(), ipfs3.stop(), ipfs4.stop()])
    await ganacheServer.close()
    await anchorLauncher.stop()
  })

  describe('Using anchor version 1', () => {
    beforeAll(async () => {
      const useSmartContractAnchors = true

      // Start anchor services
      dbConnection1 = await createDbConnection()
      casPort1 = await getPort()

      cas1 = await makeCAS(createInjector(), dbConnection1, {
        mode: 'server',
        ipfsPort: ipfsApiPort1,
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
        ganachePort: ganacheServer.port,
        port: casPort2,
        useSmartContractAnchors,
      })
      await cas2.start()
      anchorService2 = cas2.container.resolve('anchorService')

      // Finally make the Ceramic nodes that will be used in the tests.
      ceramic1 = await makeCeramicCore(ipfs3, `http://localhost:${casPort1}`, ganacheServer.url)
      ceramic2 = await makeCeramicCore(ipfs4, `http://localhost:${casPort2}`, ganacheServer.url)

      // The two user-facing ceramic nodes need to have the same DID Provider so that they can modify
      // each others streams.
      const did = makeDID()
      await did.authenticate()
      ceramic1.did = did
      ceramic2.did = did
    })

    afterAll(async () => {
      await cas1.stop()
      await cas2.stop()
      await Promise.all([dbConnection1.destroy(), dbConnection2.destroy()])
      await Promise.all([ceramic1.close(), ceramic2.close()])
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

describe('CAR file', () => {
  test('do not depend on ipfs', async () => {
    // Preparation: start a Ceramic node and an instance of CAS
    const ipfsApiPort = await getPort()
    const casIPFS = await createIPFS(ipfsApiPort)
    const ganacheServer = await makeGanache()
    const dbConnection = await createDbConnection()
    const casPort = await getPort()
    const cas = await makeCAS(createInjector(), dbConnection, {
      mode: 'server',
      ipfsPort: ipfsApiPort,
      ganachePort: ganacheServer.port,
      port: casPort,
      useSmartContractAnchors: true,
    })
    await cas.start()

    const ceramicIPFS = await createIPFS(await getPort())
    const ceramic = await makeCeramicCore(
      ceramicIPFS,
      `http://localhost:${casPort}`,
      ganacheServer.url
    )

    // Poll more often to speed up the test
    const anchorService = ceramic.context.anchorService as any
    anchorService.pollInterval = 200

    // CAS: Do not publish to IPFS
    const carFactory = new CARFactory()
    const carFile = carFactory.build()
    jest
      .spyOn(cas.container.resolve('ipfsService'), 'storeRecord')
      .mockImplementation(async (record) => {
        return carFile.put(record)
      })
    // CAS: Do not publish over pubsub
    // Now the only way a Ceramic node can get an anchor commit is a witness CAR through polling
    jest
      .spyOn(cas.container.resolve('ipfsService'), 'publishAnchorCommit')
      .mockImplementation(async () => {
        // Do Nothing
      })

    // Intercept witness CAR built on CAS side
    let witnessCAR: CAR
    const witnessService = cas.container.resolve('witnessService')
    const buildWitnessCAR = witnessService.buildWitnessCAR.bind(witnessCAR)
    const spyBuildWitnessCAR = jest
      .spyOn(witnessService, 'buildWitnessCAR')
      .mockImplementation((anchorCommitCID, merkleCAR) => {
        witnessCAR = buildWitnessCAR(anchorCommitCID, merkleCAR)
        return witnessCAR
      })

    const spyIpfsDagGet = jest.spyOn(ceramic.ipfs.dag, 'get')
    const spyImportCAR = jest.spyOn(ceramic.dispatcher, 'importCAR')

    // Start the meat of the test: create a tile stream, and anchor it
    const tile = await TileDocument.create(ceramic as any, { foo: 'blah' }, null, { anchor: true })
    await cas.container.resolve('anchorService').anchorRequests()
    await waitForAnchor(tile)

    // CAS builds a witness CAR
    expect(spyBuildWitnessCAR).toBeCalledTimes(1)
    // Ceramic node imports witness CAR prepared by CAS
    expect(spyImportCAR).toHaveBeenCalledWith(witnessCAR)
    // Ceramic node only retrieves a genesis and an anchor commits in `handleCommit`
    expect(spyIpfsDagGet.mock.calls.length).toEqual(2)

    // Teardown
    await ceramic.close()
    await cas.stop()
    await ganacheServer.close()
    await casIPFS.stop()
  })
})
