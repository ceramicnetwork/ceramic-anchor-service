import "reflect-metadata"

import CID from 'cids';
import Ganache from 'ganache-core'

import { config } from 'node-config-ts';
import { Logger as logger } from '@overnightjs/logger/lib/Logger';

import { container } from "tsyringe";

import BlockchainService from "../blockchain-service";
import EthereumBlockchainService from "../ethereum/ethereum-blockchain-service";

let ganacheServer: any = null;
let ethBc: BlockchainService = null;

describe('ETH service',  () => {
  jest.setTimeout(25000);
  beforeAll(async () => {
    container.register("blockchainService", {
      useClass: EthereumBlockchainService
    });

    ethBc = container.resolve<BlockchainService>('blockchainService');

    ganacheServer = Ganache.server({
      gasLimit: 7000000,
      time: new Date(1586784002855),
      mnemonic: 'move sense much taxi wave hurry recall stairs thank brother nut woman',
      default_balance_ether: 100,
      debug: true,
      blockTime: 2,
      network_id: 1337,
      networkId: 1337,
    });

    const localPort = config.blockchain.connectors.ethereum.rpc.port;
    const done = new Promise<void>((resolve, reject) => {
      ganacheServer.listen(localPort, async (err: Error) => {
        if (err) {
          reject(err);
          return
        }
        resolve()
      });
    });
    await done
  });

  test('should connect to local ganache server', async () => {
    await ethBc.connect();
  });

  test('should send CID to local ganache server', async () => {
    const cid = new CID('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni');
    const tx = await ethBc.sendTransaction(cid);
    expect(tx).toBeDefined();
    expect(tx).toMatchSnapshot();
  });

  test('can fetch chainId properly', async () => {
    const chainId = ethBc.chainId
    expect(chainId).toEqual("eip155:1337")
  });

  afterAll(async (done) => {
    logger.Imp(`Closing local Ethereum blockchain instance...`);
    ganacheServer.close();
    done();
  });

});
