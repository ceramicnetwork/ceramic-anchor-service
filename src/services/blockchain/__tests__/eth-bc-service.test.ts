import "reflect-metadata"

import CID from 'cids';
import Ganache from 'ganache-core'

import { config } from 'node-config-ts';
import { logger } from '../../../logger';

import { container } from "tsyringe";

import BlockchainService from "../blockchain-service";
import EthereumBlockchainService from "../ethereum/ethereum-blockchain-service";
import { BigNumber } from 'ethers';

let ganacheServer: any = null;
let ethBc: BlockchainService = null;

describe('ETH service',  () => {
  jest.setTimeout(25000);
  const blockchainStartTime = new Date(1586784002000)
  beforeAll(async () => {
    container.register("blockchainService", {
      useClass: EthereumBlockchainService
    });

    ethBc = container.resolve<BlockchainService>('blockchainService');

    ganacheServer = Ganache.server({
      gasLimit: 7000000,
      time: blockchainStartTime,
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

  afterAll(async (done) => {
    logger.imp(`Closing local Ethereum blockchain instance...`);
    ganacheServer.close();
    done();
  });

  test('should connect to local ganache server', async () => {
    await ethBc.connect();
  });

  test('should send CID to local ganache server', async () => {
    const cid = new CID('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni');
    const tx = await ethBc.sendTransaction(cid);
    expect(tx).toBeDefined();

    // checking the timestamp against the snapshot is too brittle since if the test runs slowly it
    // can be off slightly.  So we test it manually here instead.
    const blockTimestamp = tx.blockTimestamp
    delete tx.blockTimestamp
    const startTimeSeconds = Math.floor(blockchainStartTime.getTime() / 1000)
    expect(blockTimestamp).toBeGreaterThan(startTimeSeconds)
    expect(blockTimestamp).toBeLessThan(startTimeSeconds + 5)

    expect(tx).toMatchSnapshot();
  });

  test('can fetch chainId properly', async () => {
    const chainId = ethBc.chainId
    expect(chainId).toEqual("eip155:1337")
  });

  test('gas price increase math', () => {
    const currentGas = BigNumber.from(1000)
    expect(EthereumBlockchainService.increaseGasPrice(currentGas, 0)).toEqual(currentGas)
    expect(EthereumBlockchainService.increaseGasPrice(currentGas, 1)).toEqual(BigNumber.from(1100))
    expect(EthereumBlockchainService.increaseGasPrice(currentGas, 2)).toEqual(BigNumber.from(1200))
  })

});
