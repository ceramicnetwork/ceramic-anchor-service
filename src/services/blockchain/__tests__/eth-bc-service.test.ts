import "reflect-metadata"

import CID from 'cids';
import Ganache from 'ganache-core'

import { config } from 'node-config-ts';
import { logger } from '../../../logger';

import { container, instanceCachingFactory } from 'tsyringe';

import BlockchainService from "../blockchain-service";
import EthereumBlockchainService, { MAX_RETRIES } from '../ethereum/ethereum-blockchain-service';
import { BigNumber } from 'ethers';
import { ErrorCode } from '@ethersproject/logger';

describe('ETH service connected to ganache',  () => {
  jest.setTimeout(25000);
  const blockchainStartTime = new Date(1586784002000)
  let ganacheServer: any = null;
  let ethBc: BlockchainService = null;

  beforeAll(async () => {
    container.register("blockchainService", {
      useFactory: instanceCachingFactory<EthereumBlockchainService>(c => EthereumBlockchainService.make())
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
    await ethBc.connect()
  });

  afterAll(async (done) => {
    logger.imp(`Closing local Ethereum blockchain instance...`);
    ganacheServer.close();
    done();
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
    expect(EthereumBlockchainService.increaseGasPricePerAttempt(currentGas, 0)).toEqual(currentGas)
    expect(EthereumBlockchainService.increaseGasPricePerAttempt(currentGas, 1)).toEqual(BigNumber.from(1100))
    expect(EthereumBlockchainService.increaseGasPricePerAttempt(currentGas, 2)).toEqual(BigNumber.from(1200))
  })

});

describe('ETH service with mock wallet',  () => {
  let ethBc: EthereumBlockchainService = null;
  const provider = {
    estimateGas: jest.fn(),
    getBalance: jest.fn(),
    getBlock: jest.fn(),
    getGasPrice: jest.fn(),
    getNetwork: jest.fn(),
    getTransactionCount: jest.fn(),
    waitForTransaction: jest.fn(),
  }
  const wallet = {
    address: "abcd1234",
    provider: provider,
    sendTransaction: jest.fn(),
  }

  beforeEach(async () => {
    ethBc = new EthereumBlockchainService(wallet as any)

    provider.getNetwork.mockReturnValue({chainId: "1337"})
    await ethBc.connect()
  });

  test('build transaction request', async () => {
    const nonce = 5
    provider.getTransactionCount.mockReturnValue(nonce)

    const cid = new CID('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni');
    const txData = await ethBc._buildTransactionRequest(cid);
    expect(txData).toMatchSnapshot()
  });

  test('single transaction attempt', async () => {
    const nonce = 5
    const gasPrice = BigNumber.from(1000)
    const gasEstimate = BigNumber.from(10*1000)
    const txnResponse = {
      hash: "0x12345abcde",
      confirmations: 3,
      from: "me",
      chainId: "1337",
    }
    const txReceipt = {
      byzantium: true,
      status: 1,
      blockHash: "0x54321",
      blockNumber: 54321,
      transactionHash: txnResponse.hash,
    }
    const block = {
      timestamp: 54321000
    }

    provider.getGasPrice.mockReturnValue(gasPrice)
    provider.estimateGas.mockReturnValue(gasEstimate)
    wallet.sendTransaction.mockReturnValue(txnResponse)
    provider.waitForTransaction.mockReturnValue(txReceipt)
    provider.getBlock.mockReturnValue(block)

    const txRequest = {
      to: wallet.address,
      data: "0x987654321",
      nonce,
      gasPrice: gasPrice,
      gasLimit: gasEstimate,
    }
    const attempt = 0
    const network = "eip1455:1337"
    const transactionTimeoutSecs = 10
    const tx = await ethBc._trySendTransaction(txRequest, attempt, network, transactionTimeoutSecs)
    expect(tx).toMatchSnapshot()

    const txData = wallet.sendTransaction.mock.calls[0][0]
    expect(txData).toMatchSnapshot()
  });

  test('successful mocked transaction', async () => {
    const balance = BigNumber.from(10 * 1000 * 1000)
    const nonce = 5
    const gasPrice = BigNumber.from(1000)
    const gasEstimate = BigNumber.from(10*1000)

    provider.getBalance.mockReturnValue(balance)
    provider.getTransactionCount.mockReturnValue(nonce)
    provider.getGasPrice.mockReturnValue(gasPrice)
    provider.estimateGas.mockReturnValue(gasEstimate)

    const mockTrySendTransaction = jest.fn()
    ethBc._trySendTransaction = mockTrySendTransaction
    mockTrySendTransaction.mockReturnValue({txHash: "0x12345"})

    const cid = new CID('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni');
    await ethBc.sendTransaction(cid)

    expect(mockTrySendTransaction).toHaveBeenCalledTimes(1)
    const [txData, attemptNum, network, transactionTimeoutSecs] = mockTrySendTransaction.mock.calls[0]
    expect(attemptNum).toEqual(0)
    expect(network).toEqual(config.blockchain.connectors.ethereum.network)
    expect(transactionTimeoutSecs).toEqual(config.blockchain.connectors.ethereum.transactionTimeoutSecs)
    expect(txData).toMatchSnapshot()
  });

  test('insufficient funds error', async () => {
    const balance = BigNumber.from(10 * 1000 * 1000)
    const nonce = 5
    const gasPrice = BigNumber.from(1000)
    const gasEstimate = BigNumber.from(10*1000)

    provider.getBalance.mockReturnValue(balance)
    provider.getTransactionCount.mockReturnValue(nonce)
    provider.getGasPrice.mockReturnValue(gasPrice)
    provider.estimateGas.mockReturnValue(gasEstimate)

    const mockTrySendTransaction = jest.fn()
    ethBc._trySendTransaction = mockTrySendTransaction
    mockTrySendTransaction
      .mockRejectedValueOnce({code: ErrorCode.TIMEOUT})
      .mockRejectedValueOnce({code: ErrorCode.INSUFFICIENT_FUNDS})

    const cid = new CID('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni');
    await expect(ethBc.sendTransaction(cid)).rejects.toThrow(/Transaction cost is greater than our current balance/)

    // In first attempt gas cost is exactly equal to wallet balance, in second attempt it goes
    // over the wallet balance and the whole attempt is aborted
    expect(mockTrySendTransaction).toHaveBeenCalledTimes(2)

    const [txData0, attemptNum0, network0, transactionTimeoutSecs0] = mockTrySendTransaction.mock.calls[0]
    expect(attemptNum0).toEqual(0)
    expect(network0).toEqual(config.blockchain.connectors.ethereum.network)
    expect(transactionTimeoutSecs0).toEqual(config.blockchain.connectors.ethereum.transactionTimeoutSecs)
    expect(txData0).toMatchSnapshot()

    const [txData1, attemptNum1, network1, transactionTimeoutSecs1] = mockTrySendTransaction.mock.calls[1]
    expect(attemptNum1).toEqual(1)
    expect(network1).toEqual(config.blockchain.connectors.ethereum.network)
    expect(transactionTimeoutSecs1).toEqual(config.blockchain.connectors.ethereum.transactionTimeoutSecs)
    expect(txData1).toMatchSnapshot()
  });

  test('timeout error', async () => {
    const balance = BigNumber.from(10 * 1000 * 1000)
    const nonce = 5
    const gasPrice = BigNumber.from(1000)
    const gasEstimate = BigNumber.from(10*1000)

    provider.getBalance.mockReturnValue(balance)
    provider.getTransactionCount.mockReturnValue(nonce)
    provider.getGasPrice.mockReturnValue(gasPrice)
    provider.estimateGas.mockReturnValue(gasEstimate)

    const mockTrySendTransaction = jest.fn()
    ethBc._trySendTransaction = mockTrySendTransaction
    mockTrySendTransaction.mockRejectedValue({code: ErrorCode.TIMEOUT})

    const cid = new CID('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni');
    await expect(ethBc.sendTransaction(cid)).rejects.toThrow("Failed to send transaction")

    expect(mockTrySendTransaction).toHaveBeenCalledTimes(MAX_RETRIES)

    const [txData0, attemptNum0, network0, transactionTimeoutSecs0] = mockTrySendTransaction.mock.calls[0]
    expect(attemptNum0).toEqual(0)
    expect(network0).toEqual(config.blockchain.connectors.ethereum.network)
    expect(transactionTimeoutSecs0).toEqual(config.blockchain.connectors.ethereum.transactionTimeoutSecs)
    expect(txData0).toMatchSnapshot()

    const [txData1, attemptNum1, network1, transactionTimeoutSecs1] = mockTrySendTransaction.mock.calls[1]
    expect(attemptNum1).toEqual(1)
    expect(network1).toEqual(config.blockchain.connectors.ethereum.network)
    expect(transactionTimeoutSecs1).toEqual(config.blockchain.connectors.ethereum.transactionTimeoutSecs)
    expect(txData1).toMatchSnapshot()

    const [txData2, attemptNum2, network2, transactionTimeoutSecs2] = mockTrySendTransaction.mock.calls[2]
    expect(attemptNum2).toEqual(2)
    expect(network2).toEqual(config.blockchain.connectors.ethereum.network)
    expect(transactionTimeoutSecs2).toEqual(config.blockchain.connectors.ethereum.transactionTimeoutSecs)
    expect(txData2).toMatchSnapshot()
  });

});