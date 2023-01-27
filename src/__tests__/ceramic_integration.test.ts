import 'reflect-metadata'
import 'dotenv/config'
import { jest } from '@jest/globals'
import { CeramicDaemon, DaemonConfig } from '@ceramicnetwork/cli'
import { Ceramic } from '@ceramicnetwork/core'
import { AnchorStatus, fetchJson, IpfsApi, Stream, SyncOptions } from '@ceramicnetwork/common'
import { ServiceMetrics as Metrics } from '@ceramicnetwork/observability'

import { create } from 'ipfs-core'
import { HttpApi } from 'ipfs-http-server'
import * as dagJose from 'dag-jose'

import express from 'express'
import Ganache from 'ganache-core'
import tmp from 'tmp-promise'
import getPort from 'get-port'
import type { Knex } from 'knex'
import { clearTables, createDbConnection } from '../db-connection.js'
import { CeramicAnchorApp } from '../app.js'
import { config } from 'node-config-ts'
import cloneDeep from 'lodash.clonedeep'
import { TileDocument } from '@ceramicnetwork/stream-tile'
import { filter } from 'rxjs/operators'
import { firstValueFrom, timeout, throwError, interval, concatMap } from 'rxjs'
import { DID } from 'dids'
import { Ed25519Provider } from 'key-did-provider-ed25519'
import * as sha256 from '@stablelib/sha256'
import * as uint8arrays from 'uint8arrays'
import * as random from '@stablelib/random'
import * as KeyDidResolver from 'key-did-resolver'
import { Utils } from '../utils.js'
import { RequestRepository } from '../repositories/request-repository.js'
import { Request, RequestStatus } from '../models/request.js'
import { CID } from 'multiformats/cid'
import { AnchorService } from '../services/anchor-service.js'
import { METRIC_NAMES } from '../settings.js'
import { Server } from 'http'
import type { Injector } from 'typed-inject'
import { createInjector } from 'typed-inject'

process.env.NODE_ENV = 'test'

const randomNumber = Math.floor(Math.random() * 10000)
const TOPIC = '/ceramic/local/' + randomNumber

/**
 * Create an IPFS instance
 */
async function createIPFS(apiPort?: number): Promise<IpfsApi> {
  const tmpFolder = await tmp.dir({ unsafeCleanup: true })
  const swarmPort = await getPort()

  const config = {
    ipld: { codecs: [dagJose] },
    repo: `${tmpFolder.path}/ipfs${swarmPort}/`,
    config: {
      Addresses: {
        Swarm: [`/ip4/127.0.0.1/tcp/${swarmPort}`],
        ...(apiPort && { API: `/ip4/127.0.0.1/tcp/${apiPort}` }),
      },
      Discovery: { DNS: { Enabled: false }, webRTCStar: { Enabled: false } },
      Bootstrap: [],
    },
  }

  console.log(`starting IPFS node with config: ${JSON.stringify(config, null, 2)}`)
  return create(config)
}

async function swarmConnect(a: IpfsApi, b: IpfsApi) {
  const addressB = (await b.id()).addresses[0]
  await a.swarm.connect(addressB)
}

async function makeCeramicCore(
  ipfs: IpfsApi,
  anchorServiceUrl: string,
  ethereumRpcUrl: string | undefined
): Promise<Ceramic> {
  const tmpFolder = await tmp.dir({ unsafeCleanup: true })
  const ceramic = await Ceramic.create(ipfs, {
    networkName: 'local',
    pubsubTopic: TOPIC,
    stateStoreDirectory: tmpFolder.path,
    anchorServiceUrl,
    ethereumRpcUrl,
  })
  ceramic.did = makeDID()
  await ceramic.did.authenticate()
  return ceramic
}

function makeDID(): DID {
  const seed = random.randomString(32)
  const digest = sha256.hash(uint8arrays.fromString(seed))
  const provider = new Ed25519Provider(digest)
  const resolver = KeyDidResolver.getResolver()
  return new DID({ provider, resolver })
}

async function makeGanache(startTime: Date, port: number): Promise<Ganache.Server> {
  const ganacheServer = Ganache.server({
    gasLimit: 7000000,
    time: startTime,
    mnemonic: 'move sense much taxi wave hurry recall stairs thank brother nut woman',
    default_balance_ether: 100,
    debug: true,
    blockTime: 2,
    network_id: 1337,
    networkId: 1337,
  })

  await ganacheServer.listen(port)
  return ganacheServer
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
  container: Injector<{}>,
  dbConnection: Knex,
  minConfig: MinimalCASConfig
): Promise<CeramicAnchorApp> {
  const configCopy = cloneDeep(config)
  configCopy.mode = minConfig.mode
  configCopy.port = minConfig.port
  configCopy.anchorControllerEnabled = true
  configCopy.merkleDepthLimit = 0
  configCopy.minStreamCount = 1
  configCopy.ipfsConfig.url = 'http://localhost:' + minConfig.ipfsPort
  configCopy.ipfsConfig.pubsubTopic = TOPIC
  configCopy.ceramic.apiUrl = 'http://localhost:' + minConfig.ceramicPort
  configCopy.blockchain.connectors.ethereum.network = 'ganache'
  configCopy.blockchain.connectors.ethereum.rpc.port = minConfig.ganachePort + ''
  configCopy.useSmartContractAnchors = minConfig.useSmartContractAnchors
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

async function waitForTip(stream: Stream, tip: CID, timeoutMS = 30 * 1000): Promise<void> {
  await firstValueFrom(
    stream.pipe(
      filter((state) => {
        return state.log[state.log.length - 1].cid.toString() === tip.toString()
      }),
      timeout({
        each: timeoutMS,
        with: () =>
          throwError(
            () =>
              new Error(
                `Timeout waiting for ceramic to receive cid ${tip.toString()} for stream ${stream.id.toString()}`
              )
          ),
      })
    )
  )
}

async function waitForNoReadyRequests(
  requestRepo: RequestRepository,
  timeoutMS = 30 * 1000
): Promise<void> {
  await firstValueFrom(
    interval(1000).pipe(
      concatMap(() => requestRepo.findByStatus(RequestStatus.READY)),
      filter((requests) => requests.length == 0),
      timeout({
        each: timeoutMS,
        with: () =>
          throwError(
            () => new Error(`Timeout waiting for requests to move from READY to PROCESSING`)
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

  let ipfsServer1: HttpApi
  let ipfsServer2: HttpApi

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

  const blockchainStartTime = new Date(1586784002000)
  let ganachePort
  let ganacheServer: Ganache.Server
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

    ipfsServer1 = new HttpApi(ipfs1)
    await ipfsServer1.start()
    ipfsServer2 = new HttpApi(ipfs2)
    await ipfsServer2.start()

    // Now make sure all ipfs nodes are connected to all other ipfs nodes
    const ipfsNodes = [ipfs1, ipfs2, ipfs3, ipfs4, ipfs5, ipfs6]
    for (const [i, _] of ipfsNodes.entries()) {
      for (const [j, _] of ipfsNodes.entries()) {
        if (i == j) {
          continue
        }
        await swarmConnect(ipfsNodes[i], ipfsNodes[j])
      }
    }

    // Start up Ganache
    ganachePort = await getPort()
    ganacheServer = await makeGanache(blockchainStartTime, ganachePort)

    // Start faux anchor launcher
    anchorLauncher = makeAnchorLauncher(8001)
  })

  beforeEach(async () => {
    await clearTables(dbConnection1)
    await clearTables(dbConnection2)
  })

  afterAll(async () => {
    await Promise.all([ipfsServer1.stop(), ipfsServer2.stop()])
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

  describe.skip.each([0, 1])('Using anchor version %i', (version) => {
    beforeAll(async () => {
      const useSmartContractAnchors = version === 1

      // Start anchor services
      const daemonPort1 = await getPort()
      const daemonPort2 = await getPort()
      dbConnection1 = await createDbConnection()
      casPort1 = await getPort()

      cas1 = await makeCAS(createInjector(), dbConnection1, {
        mode: 'server',
        ipfsPort: ipfsApiPort1,
        ceramicPort: daemonPort1,
        ganachePort,
        port: casPort1,
        useSmartContractAnchors,
      })
      await cas1.start()
      anchorService1 = cas1.container.resolve('anchorService')

      dbConnection2 = await createDbConnection()
      const casPort2 = await getPort()
      cas2 = await makeCAS(createInjector(), dbConnection2, {
        mode: 'server',
        ipfsPort: ipfsApiPort2,
        ceramicPort: daemonPort2,
        ganachePort,
        port: casPort2,
        useSmartContractAnchors,
      })
      await cas2.start()
      anchorService2 = cas2.container.resolve('anchorService')

      const ganacheURL = 'http://localhost:' + ganachePort

      // Make the Ceramic nodes that will be used by the CAS.
      ;[casCeramic1, casCeramic2] = await Promise.all([
        makeCeramicCore(ipfs3, 'http://localhost:' + casPort1, ganacheURL),
        makeCeramicCore(ipfs4, 'http://localhost:' + casPort2, ganacheURL),
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
      ceramic1 = await makeCeramicCore(ipfs5, 'http://localhost:' + casPort1, ganacheURL)
      ceramic2 = await makeCeramicCore(ipfs6, 'http://localhost:' + casPort2, ganacheURL)

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

      test(
        'Anchors on different CAS instances can run in parallel',
        async () => {
          const doc1 = await TileDocument.create(ceramic1, { foo: 1 }, null, { anchor: true })
          const doc2 = await TileDocument.create(ceramic2, { cheese: 1 }, null, { anchor: true })

          expect(doc1.state.anchorStatus).toEqual(AnchorStatus.PENDING)
          expect(doc2.state.anchorStatus).toEqual(AnchorStatus.PENDING)

          // Marks one of the requests as READY. This causes the first anchorUpdate to only anchor that one request.
          const requestRepo1 = cas1.container.resolve('requestRepository')
          await requestRepo1.findAndMarkReady(1)

          await Promise.all([
            anchorUpdate(doc1, cas1, anchorService1),
            // we wait for the first request to be picked up before we anchor the next request
            waitForNoReadyRequests(requestRepo1).then(() =>
              anchorUpdate(doc2, cas2, anchorService2)
            ),
          ])

          expect(doc1.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)
          expect(doc2.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)

          console.log('Test complete: Anchors on different CAS instances can run in parallel')
        },
        60 * 1000 * 3
      )
    })

    describe('Consensus for anchors', () => {
      test(
        'Anchors latest available tip from network',
        async () => {
          const initialContent = { foo: 0 }
          const updatedContent = { foo: 1 }

          const doc1 = await TileDocument.create(ceramic1, initialContent, null, { anchor: true })
          expect(doc1.state.anchorStatus).toEqual(AnchorStatus.PENDING)

          // Perform update on ceramic2
          const doc2 = await TileDocument.load(ceramic2, doc1.id)
          await doc2.update(updatedContent, null, { anchor: false })

          // Make sure that the ceramic CAS has received the newest version
          const casDocRef = await casCeramic1.loadStream(doc1.id)
          await waitForTip(casDocRef, doc2.tip)

          // Make sure that cas1 updates the newest version that was created on ceramic2, even though
          // the request that ceramic1 made against cas1 was for an older version.
          await anchorUpdate(doc1, cas1, anchorService1)
          expect(doc1.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)
          expect(doc1.content).toEqual(updatedContent)

          console.log('Test complete: Anchors latest available tip from network')
        },
        60 * 1000 * 2
      )

      test('Anchor discovered through pubsub', async () => {
        jest.setTimeout(60 * 1000 * 2)
        // In ceramic the stream waits for a successful anchor by polling the request endpoint of the CAS.
        // We alter the CAS' returned request anchor status so that it is always pending.
        // The ceramic node will then have to hear about the successful anchor through pubsub
        const requestRepo = cas1.container.resolve('requestRepository')
        const original = requestRepo.findByCid
        requestRepo.findByCid = async (cid: CID): Promise<Request> => {
          const result: Request = await original.apply(requestRepo, [cid])

          if (result) {
            return Object.assign(result, { status: AnchorStatus.PENDING })
          }

          return result
        }

        try {
          const initialContent = { foo: 0 }
          const updatedContent = { foo: 1 }

          const doc1 = await TileDocument.create(ceramic1, initialContent, null, { anchor: true })
          expect(doc1.state.anchorStatus).toEqual(AnchorStatus.PENDING)

          const doc2 = await TileDocument.load(ceramic2, doc1.id)
          await doc2.update(updatedContent, null, { anchor: false })

          // Make sure that the ceramic CAS has received the newest version
          const casDocRef = await casCeramic1.loadStream(doc1.id)
          await waitForTip(casDocRef, doc2.tip)

          await anchorUpdate(doc1, cas1, anchorService1)

          expect(doc1.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)
          expect(doc1.content).toEqual(updatedContent)

          await waitForAnchor(doc2)
          await doc2.sync({ sync: SyncOptions.NEVER_SYNC })
          expect(doc2.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)
          expect(doc2.content).toEqual(updatedContent)
        } finally {
          requestRepo.findByCid = original
        }

        console.log('Test complete: Anchor discovered through pubsub')
      })
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

    test('Can retrieve completed request when the request CID was not the stream tip when anchored', async () => {
      const doc1 = await TileDocument.create(ceramic1, { foo: 1 }, null, { anchor: true })
      const originalTip = doc1.tip
      await doc1.update({ foo: 2 }, null, { anchor: true })
      const nextTip = doc1.tip

      expect(doc1.state.anchorStatus).toEqual(AnchorStatus.PENDING)

      await anchorUpdate(doc1, cas1, anchorService1)

      expect(doc1.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)

      const nextTipRequest = await fetchJson(
        'http://localhost:' + casPort1 + '/api/v0/requests/' + nextTip.toString()
      )
      expect(RequestStatus[nextTipRequest.status]).toEqual(RequestStatus.COMPLETED)

      const originalTipRequest = await fetchJson(
        'http://localhost:' + casPort1 + '/api/v0/requests/' + originalTip.toString()
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
        'http://localhost:' + casPort1 + '/api/v0/requests/' + tipWithRequest.toString()
      )
      expect(RequestStatus[tipWithRequestInfo.status]).toEqual(RequestStatus.COMPLETED)

      await fetchJson('http://localhost:' + casPort1 + '/api/v0/requests', {
        method: 'POST',
        body: {
          streamId: doc1.id.toString(),
          docId: doc1.id.toString(),
          cid: tipWithNoRequest.toString(),
        },
      })

      const tipWithNoRequestBeforeAnchorInfo = await fetchJson(
        'http://localhost:' + casPort1 + '/api/v0/requests/' + tipWithNoRequest.toString()
      )
      expect(RequestStatus[tipWithNoRequestBeforeAnchorInfo.status]).toEqual(RequestStatus.PENDING)

      await anchorService1.emitAnchorEventIfReady()
      await cas1.anchor()

      const tipWithNoRequestAfterAnchorInfo = await fetchJson(
        'http://localhost:' + casPort1 + '/api/v0/requests/' + tipWithNoRequest.toString()
      )
      expect(RequestStatus[tipWithNoRequestAfterAnchorInfo.status]).toEqual(RequestStatus.COMPLETED)
    })
  })
})
