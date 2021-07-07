import { CeramicDaemon } from '@ceramicnetwork/cli';
import Ceramic from '@ceramicnetwork/core';
import { AnchorStatus, IpfsApi, Stream, SyncOptions } from '@ceramicnetwork/common';

import IPFS from 'ipfs-core';
import HttpApi from 'ipfs-http-server';
import dagJose from 'dag-jose';
import { convert } from 'blockcodec-to-ipld-format';

import Ganache from 'ganache-core';
import tmp from 'tmp-promise';
import getPort from 'get-port';
import { Connection } from 'typeorm';
import DBConnection from '../services/__tests__/db-connection';
import CeramicAnchorApp from '../app';
import { container } from 'tsyringe';
import { config } from 'node-config-ts';
import cloneDeep from 'lodash.clonedeep';
import { TileDocument } from '@ceramicnetwork/stream-tile';
import { filter, take } from 'rxjs/operators';
import { DID } from 'dids';
import { Ed25519Provider } from 'key-did-provider-ed25519';
import * as sha256 from '@stablelib/sha256';
import * as uint8arrays from 'uint8arrays';
import * as random from '@stablelib/random';
import KeyDidResolver from 'key-did-resolver';
import Utils from '../utils';


process.env.NODE_ENV = 'test';

const randomNumber = Math.floor(Math.random() * 10000)
const TOPIC = '/ceramic/local/' + randomNumber

/**
 * Create an IPFS instance
 */
async function createIPFS(apiPort?: number): Promise<IpfsApi> {
  const tmpFolder = await tmp.dir({ unsafeCleanup: true })
  const swarmPort = await getPort();
  const format = convert(dagJose);

  const config = {
    ipld: { formats: [format] },
    repo: `${tmpFolder.path}/ipfs${swarmPort}/`,
    config: {
      Addresses: { Swarm: [`/ip4/127.0.0.1/tcp/${swarmPort}`],
                   ...apiPort && {API: `/ip4/127.0.0.1/tcp/${apiPort}`},},
      Discovery: { DNS: { Enabled: false }, webRTCStar: { Enabled: false } },
      Bootstrap: [],
    },
  };

  console.log(`starting IPFS node with config: ${JSON.stringify(config, null, 2)}`)
  return IPFS.create(config);
}

async function swarmConnect(a: IpfsApi, b: IpfsApi) {
  const addressB = (await b.id()).addresses[0];
  await a.swarm.connect(addressB);
}

async function makeCeramicCore(ipfs: IpfsApi, anchorServiceUrl: string | null, ethereumRpcUrl: string | null): Promise<Ceramic> {
  const tmpFolder = await tmp.dir({ unsafeCleanup: true })
  const gateway = !anchorServiceUrl
  const ceramic = await Ceramic.create(ipfs, {networkName: 'local', pubsubTopic: TOPIC, stateStoreDirectory: tmpFolder.path, anchorServiceUrl, gateway, ethereumRpcUrl})
  ceramic.did = makeDID()
  await ceramic.did.authenticate()
  return ceramic
}

function makeDID(): DID {
  const seed = random.randomString(32);
  const digest = sha256.hash(uint8arrays.fromString(seed));
  const provider = new Ed25519Provider(digest);
  const resolver = KeyDidResolver.getResolver();
  return new DID({ provider, resolver });
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
  });

  await ganacheServer.listen(port);
  return ganacheServer
}

interface MinimalCASConfig {
  ipfsPort: number,
  ceramicPort: number,
  ganachePort: number,
  mode: string,
  port: number,
}

async function makeCAS(dbConnection: Connection, minConfig: MinimalCASConfig): Promise<CeramicAnchorApp> {
  const configCopy = cloneDeep(config)
  configCopy.mode = minConfig.mode
  configCopy.port = minConfig.port
  configCopy.anchorControllerEnabled = true
  configCopy.ipfsConfig.url = 'http://localhost:' + minConfig.ipfsPort
  configCopy.ipfsConfig.pubsubTopic = TOPIC
  configCopy.ceramic.apiUrl = 'http://localhost:' + minConfig.ceramicPort
  configCopy.blockchain.connectors.ethereum.network = "ganache"
  configCopy.blockchain.connectors.ethereum.rpc.port = minConfig.ganachePort + ''
  const childContainer = container.createChildContainer()
  return new CeramicAnchorApp(childContainer, configCopy, dbConnection)
}

export async function anchorUpdate(stream: Stream, anchorService: CeramicAnchorApp): Promise<void> {
  // The anchor request is not guaranteed to already have been sent to the CAS when the create/update
  // promise resolves, so we wait a bit to give the ceramic node time to actually send the request
  // before triggering the anchor.
  // TODO: Remove this once Ceramic won't return from a request that makes an anchor without having
  // already made the anchor request against the CAS.
  await Utils.delay(500)

  await anchorService.anchor();
  await stream
    .pipe(
      filter((state) => [AnchorStatus.ANCHORED, AnchorStatus.FAILED].includes(state.anchorStatus)),
      take(1),
    )
    .toPromise();
}

describe('Ceramic Integration Test',  () => {
  jest.setTimeout(60 * 1000 * 10)

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

  let dbConnection1: Connection
  let dbConnection2: Connection

  let cas1: CeramicAnchorApp
  let cas2: CeramicAnchorApp

  const blockchainStartTime = new Date(1586784002000)
  let ganachePort;
  let ganacheServer: Ganache.Server = null;

  beforeAll(async () => {
    const ipfsApiPort1 = await getPort();
    const ipfsApiPort2 = await getPort();

    [ipfs1, ipfs2, ipfs3, ipfs4, ipfs5, ipfs6] = await Promise.all([
      createIPFS(ipfsApiPort1),
      createIPFS(ipfsApiPort2),
      createIPFS(),
      createIPFS(),
      createIPFS(),
      createIPFS()]);

    ipfsServer1 = new HttpApi(ipfs1);
    await ipfsServer1.start()
    ipfsServer2 = new HttpApi(ipfs2);
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
    ganachePort = await getPort();
    const ganacheURL = 'http://localhost:' + ganachePort
    ganacheServer = await makeGanache(blockchainStartTime, ganachePort);

    // Make the Ceramic nodes that will be used by the CAS.
    [casCeramic1, casCeramic2] = await Promise.all([
      makeCeramicCore(ipfs3, null, ganacheURL),
      makeCeramicCore(ipfs4, null, ganacheURL)])
    const daemonPort1 = await getPort()
    const daemonPort2 = await getPort()
    daemon1 = new CeramicDaemon(casCeramic1, { port: daemonPort1 })
    daemon2 = new CeramicDaemon(casCeramic1, { port: daemonPort2 })
    await daemon1.listen()
    await daemon2.listen()

    // Start anchor services
    dbConnection1 = await DBConnection.create()
    const casPort1 = await getPort();
    cas1 = await makeCAS(dbConnection1,
      {
        mode: "server",
        ipfsPort: ipfsApiPort1,
        ceramicPort: daemonPort1,
        ganachePort,
        port: casPort1,
      })
    await cas1.start()

    dbConnection2 = await DBConnection.create()
    const casPort2 = await getPort();
    cas2 = await makeCAS(dbConnection2,
      {
        mode: "server",
        ipfsPort: ipfsApiPort2,
        ceramicPort: daemonPort2,
        ganachePort,
        port: casPort2,
      })
    await cas2.start()

    // Finally make the Ceramic nodes that will be used in the tests.
    ceramic1 = await makeCeramicCore(ipfs5, 'http://localhost:' + casPort1, ganacheURL)
    ceramic2 = await makeCeramicCore(ipfs6, 'http://localhost:' + casPort2, ganacheURL)

    // The two user-facing ceramic nodes need to have the same DID Provider so that they can modify
    // each others streams.
    const did = makeDID()
    await did.authenticate()
    ceramic1.did = did
    ceramic2.did = did
  });

  afterAll(async () => {
    cas1.stop();
    cas2.stop();
    await Promise.all([dbConnection1.close(), dbConnection2.close()])
    await Promise.all([daemon1.close(), daemon2.close()])
    await Promise.all([casCeramic1.close(), casCeramic2.close(), ceramic1.close(), ceramic2.close()])
    await Promise.all([ipfsServer1.stop(), ipfsServer2.stop()])
    await Promise.all([ipfs1.stop(), ipfs2.stop(), ipfs3.stop(), ipfs4.stop(), ipfs5.stop(), ipfs6.stop()])
    await ganacheServer.close()
  });

  beforeEach(async () => {
    console.log(`Starting test: ${expect.getState().currentTestName}`);
  })

  afterEach(async () => {
    console.log(`Finished test: ${expect.getState().currentTestName}`);
  })

  describe('Multiple CAS instances in same process works',  () => {
    test('Anchors on different CAS instances are independent', async () => {
      const doc1 = await TileDocument.create(ceramic1, { foo: 1 }, null, { anchor: true })
      const doc2 = await TileDocument.create(ceramic2, { foo: 1 }, null, { anchor: true })

      expect(doc1.state.anchorStatus).toEqual(AnchorStatus.PENDING)
      expect(doc2.state.anchorStatus).toEqual(AnchorStatus.PENDING)

      // Test that anchoring on CAS1 doesn't anchor requests made against CAS2
      await anchorUpdate(doc1, cas1)
      expect(doc1.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)
      expect(doc2.state.anchorStatus).toEqual(AnchorStatus.PENDING)

      // Now test that anchoring on CAS2 doesn't anchor requests made against CAS1
      await doc1.update({ foo: 2 }, null, { anchor: true })
      await anchorUpdate(doc2, cas2)
      expect(doc1.state.anchorStatus).toEqual(AnchorStatus.PENDING)
      expect(doc2.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)
    }, 60 * 1000 * 3);

    test('Multiple anchors for same stream', async () => {
      const doc1 = await TileDocument.create(ceramic1, { foo: 1 }, null, { anchor: true })
      expect(doc1.state.anchorStatus).toEqual(AnchorStatus.PENDING)
      await anchorUpdate(doc1, cas1)
      expect(doc1.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)

      // Now that genesis commit has been anchored do an update and make sure anchoring works again
      await doc1.update({ foo: 2 }, null, { anchor: true })
      await anchorUpdate(doc1, cas1)
      expect(doc1.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)
      expect(doc1.content).toEqual({ foo: 2 })
    }, 60 * 1000 * 3);
  });

  describe('Consensus for anchors',  () => {
    test('Anchors latest available tip from network', async () => {
      const initialContent = { foo: 0 }
      const updatedContent = { foo: 1 }

      const doc1 = await TileDocument.create(ceramic1, initialContent, null, { anchor: true })
      expect(doc1.state.anchorStatus).toEqual(AnchorStatus.PENDING)

      const doc2 = await TileDocument.load(ceramic2, doc1.id)
      await doc2.update(updatedContent, null, { anchor: true })

      await doc1.sync({ sync: SyncOptions.SYNC_ALWAYS })
      expect(doc2.content).toEqual(updatedContent)
      expect(doc1.content).toEqual(updatedContent)

      const docOnCas1Ceramic = await TileDocument.load(casCeramic1, doc1.id)
      const docOnCas2Ceramic = await TileDocument.load(casCeramic2, doc1.id)
      expect(docOnCas1Ceramic.content).toEqual(updatedContent)
      expect(docOnCas2Ceramic.content).toEqual(updatedContent)

      // At this point we have verified that *all* involved ceramic nodes (both user-facing ceramic
      // nodes as well as both ceramic nodes used by the 2 anchor services) all know about the newest
      // version of the stream.
      await anchorUpdate(doc1, cas1)
      expect(doc1.state.anchorStatus).toEqual(AnchorStatus.ANCHORED)

      // This fails! Even though all Ceramic nodes know about the new update, 'cas1' still anchors
      // the genesis contents that it was told to anchor.
      // TODO(#253): Uncomment this once CAS consensus rules are improved
      //expect(doc1.content).toEqual(updatedContent)
    }, 60 * 1000 * 2);
  });

});
