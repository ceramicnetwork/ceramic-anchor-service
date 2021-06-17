import { CeramicDaemon } from '@ceramicnetwork/cli';
import Ceramic from '@ceramicnetwork/core'
import { IpfsApi } from '@ceramicnetwork/common';

import IPFS from 'ipfs-core';
import dagJose from 'dag-jose';
import { convert } from 'blockcodec-to-ipld-format'

import tmp from 'tmp-promise'
import getPort from 'get-port';

process.env.NODE_ENV = 'test';

const randomNumber = Math.floor(Math.random() * 10000)
const TOPIC = '/ceramic/local/' + randomNumber

/**
 * Create an IPFS instance
 */
export async function createIPFS(): Promise<IpfsApi> {
  const tmpFolder = await tmp.dir({ unsafeCleanup: true })
  const port = await getPort();
  const format = convert(dagJose);

  const config = {
    ipld: { formats: [format] },
    repo: `${tmpFolder.path}/ipfs${port}/`,
    config: {
      Addresses: { Swarm: [`/ip4/127.0.0.1/tcp/${port}`] },
      Discovery: { DNS: { Enabled: false }, webRTCStar: { Enabled: false } },
      Bootstrap: [],
    },
  };

  return IPFS.create(config);
}

export async function swarmConnect(a: IpfsApi, b: IpfsApi) {
  const addressB = (await b.id()).addresses[0];
  await a.swarm.connect(addressB);
}

const makeCeramicCore = async(ipfs: IpfsApi): Promise<Ceramic> => {
  const tmpFolder = await tmp.dir({ unsafeCleanup: true })
  return await Ceramic.create(ipfs, {networkName: 'local', pubsubTopic: TOPIC, stateStoreDirectory: tmpFolder.path})
}

describe('Ceramic Integration Test',  () => {
  jest.setTimeout(60000);

  let ipfs1: IpfsApi
  let ipfs2: IpfsApi
  let ipfs3: IpfsApi
  let ipfs4: IpfsApi
  let ipfs5: IpfsApi
  let ipfs6: IpfsApi

  let core1: Ceramic
  let core2: Ceramic
  let core3: Ceramic
  let core4: Ceramic

  let daemon1: CeramicDaemon
  let daemon2: CeramicDaemon
  let daemon3: CeramicDaemon
  let daemon4: CeramicDaemon

  beforeAll(async () => {
    ipfs1 = await createIPFS();
    ipfs2 = await createIPFS();
    ipfs3 = await createIPFS();
    ipfs4 = await createIPFS();
    ipfs5 = await createIPFS();
    ipfs6 = await createIPFS();

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

    [core1, core2, core3, core4] = await Promise.all([makeCeramicCore(ipfs1), makeCeramicCore(ipfs2), makeCeramicCore(ipfs3), makeCeramicCore(ipfs4)])
  });

  afterAll(async () => {
    await Promise.all([ipfs1.stop(), ipfs2.stop(), ipfs3.stop(), ipfs4.stop(), ipfs5.stop(), ipfs6.stop()])
  });

  test('Basic integration', async () => {
    expect(true).toEqual(true)
  });


});
