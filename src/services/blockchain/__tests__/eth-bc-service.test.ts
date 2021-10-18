import 'reflect-metadata'

import CID from 'cids'
import Ganache from 'ganache-core'

import { config } from 'node-config-ts'
import { logger } from '../../../logger'

import { container, instanceCachingFactory } from 'tsyringe'

import BlockchainService from '../blockchain-service'
import EthereumBlockchainService, { MAX_RETRIES } from '../ethereum/ethereum-blockchain-service'
import { BigNumber } from 'ethers'
import { ErrorCode } from '@ethersproject/logger'

describe('ETH service connected to ganache', () => {
  jest.setTimeout(25000)
  const blockchainStartTime = new Date(1586784002000)
  let ganacheServer: any = null
  let ethBc: BlockchainService = null

  beforeAll(async () => {
    container.register('blockchainService', {
      useFactory: instanceCachingFactory<EthereumBlockchainService>((c) =>
        EthereumBlockchainService.make(config)
      ),
    })

    ethBc = container.resolve<BlockchainService>('blockchainService')

    ganacheServer = Ganache.server({
      gasLimit: 7000000,
      time: blockchainStartTime,
      mnemonic: 'move sense much taxi wave hurry recall stairs thank brother nut woman',
      default_balance_ether: 100,
      debug: true,
      blockTime: 2,
      network_id: 1337,
      networkId: 1337,
    })

    const localPort = config.blockchain.connectors.ethereum.rpc.port
    const done = new Promise<void>((resolve, reject) => {
      ganacheServer.listen(localPort, async (err: Error) => {
        if (err) {
          reject(err)
          return
        }
        resolve()
      })
    })
    await done
    await ethBc.connect()
  })

  afterAll(async (done) => {
    logger.imp(`Closing local Ethereum blockchain instance...`)
    ganacheServer.close()
    done()
  })

  test('should send CID to local ganache server', async () => {
    const cid = new CID('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
    const tx = await ethBc.sendTransaction(cid)
    expect(tx).toBeDefined()

    // checking the timestamp against the snapshot is too brittle since if the test runs slowly it
    // can be off slightly.  So we test it manually here instead.
    const blockTimestamp = tx.blockTimestamp
    delete tx.blockTimestamp
    const startTimeSeconds = Math.floor(blockchainStartTime.getTime() / 1000)
    expect(blockTimestamp).toBeGreaterThan(startTimeSeconds)
    expect(blockTimestamp).toBeLessThan(startTimeSeconds + 5)

    expect(tx).toMatchSnapshot()
  })

  test('can fetch chainId properly', async () => {
    const chainId = ethBc.chainId
    expect(chainId).toEqual('eip155:1337')
  })

  test('gas price increase math', () => {
    const gasEstimate = BigNumber.from(1000)
    const firstRetry = BigNumber.from(1100)
    // Note that this is not 1200. It needs to be 10% over the previous attempt's gas,
    // not 20% over the gas estimate
    const secondRetry = BigNumber.from(1210)
    expect(
      EthereumBlockchainService.increaseGasPricePerAttempt(gasEstimate, 0, undefined).toNumber()
    ).toEqual(gasEstimate.toNumber())
    expect(
      EthereumBlockchainService.increaseGasPricePerAttempt(gasEstimate, 1, gasEstimate).toNumber()
    ).toEqual(firstRetry.toNumber())
    expect(
      EthereumBlockchainService.increaseGasPricePerAttempt(gasEstimate, 2, firstRetry).toNumber()
    ).toEqual(secondRetry.toNumber())
  })
})

describe('ETH service with mock wallet', () => {
  let ethBc: EthereumBlockchainService = null
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
    address: 'abcd1234',
    provider: provider,
    sendTransaction: jest.fn(),
  }

  beforeEach(async () => {
    ethBc = new EthereumBlockchainService(config, wallet as any)

    provider.getNetwork.mockReturnValue({ chainId: '1337' })
    await ethBc.connect()
  })

  test('build transaction request', async () => {
    const nonce = 5
    provider.getTransactionCount.mockReturnValue(nonce)

    const cid = new CID('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
    const txData = await ethBc._buildTransactionRequest(cid)
    expect(txData).toMatchSnapshot()
  })

  test('single transaction attempt', async () => {
    const nonce = 5
    const gasPrice = BigNumber.from(1000)
    const gasEstimate = BigNumber.from(10 * 1000)
    const txnResponse = {
      hash: '0x12345abcde',
      confirmations: 3,
      from: 'me',
      chainId: '1337',
    }
    const txReceipt = {
      byzantium: true,
      status: 1,
      blockHash: '0x54321',
      blockNumber: 54321,
      transactionHash: txnResponse.hash,
    }
    const block = {
      timestamp: 54321000,
    }

    provider.getGasPrice.mockReturnValue(gasPrice)
    provider.estimateGas.mockReturnValue(gasEstimate)
    wallet.sendTransaction.mockReturnValue(txnResponse)
    provider.waitForTransaction.mockReturnValue(txReceipt)
    provider.getBlock.mockReturnValue(block)

    const txRequest = {
      to: wallet.address,
      data: '0x987654321',
      nonce,
      gasPrice: gasPrice,
      gasLimit: gasEstimate,
    }
    const attempt = 0

    const txResponse = await ethBc._trySendTransaction(txRequest, attempt)
    expect(txResponse).toMatchSnapshot()
    const tx = await ethBc._confirmTransactionSuccess(txResponse)
    expect(tx).toMatchSnapshot()

    const txData = wallet.sendTransaction.mock.calls[0][0]
    expect(txData).toMatchSnapshot()
  })

  test('successful mocked transaction', async () => {
    const balance = BigNumber.from(10 * 1000 * 1000)
    const nonce = 5
    const gasPrice = BigNumber.from(1000)
    const gasEstimate = BigNumber.from(10 * 1000)
    const txResponse = { foo: 'bar' }
    const finalTransactionResult = { txHash: '0x12345' }

    provider.getBalance.mockReturnValue(balance)
    provider.getTransactionCount.mockReturnValue(nonce)
    provider.getGasPrice.mockReturnValue(gasPrice)
    provider.estimateGas.mockReturnValue(gasEstimate)

    const mockTrySendTransaction = jest.fn()
    const mockConfirmTransactionSuccess = jest.fn()
    ethBc._trySendTransaction = mockTrySendTransaction
    ethBc._confirmTransactionSuccess = mockConfirmTransactionSuccess
    mockTrySendTransaction.mockReturnValue(txResponse)
    mockConfirmTransactionSuccess.mockReturnValue(finalTransactionResult)

    const cid = new CID('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
    await expect(ethBc.sendTransaction(cid)).resolves.toEqual(finalTransactionResult)

    expect(mockTrySendTransaction).toHaveBeenCalledTimes(1)
    const [txData, attemptNum] = mockTrySendTransaction.mock.calls[0]
    expect(attemptNum).toEqual(0)
    expect(txData).toMatchSnapshot()

    expect(mockConfirmTransactionSuccess).toHaveBeenCalledTimes(1)
    const [txResponseReceived] = mockConfirmTransactionSuccess.mock.calls[0]
    expect(txResponseReceived).toEqual(txResponse)
  })

  test('insufficient funds error', async () => {
    const balance = BigNumber.from(10 * 1000 * 1000)
    const nonce = 5
    const gasPrice = BigNumber.from(1000)
    const gasEstimate = BigNumber.from(10 * 1000)

    provider.getBalance.mockReturnValue(balance)
    provider.getTransactionCount.mockReturnValue(nonce)
    provider.getGasPrice.mockReturnValue(gasPrice)
    provider.estimateGas.mockReturnValue(gasEstimate)

    const mockTrySendTransaction = jest.fn()
    ethBc._trySendTransaction = mockTrySendTransaction
    mockTrySendTransaction
      .mockRejectedValueOnce({ code: ErrorCode.TIMEOUT })
      .mockRejectedValueOnce({ code: ErrorCode.INSUFFICIENT_FUNDS })

    const cid = new CID('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
    await expect(ethBc.sendTransaction(cid)).rejects.toThrow(
      /Transaction cost is greater than our current balance/
    )

    // In the first attempt we have exactly enough balance in our wallet to cover the cost, but the
    // transaction times out. On retry, the gas cost is increased and goes over the wallet balance,
    // causing the attempt to be aborted.
    expect(mockTrySendTransaction).toHaveBeenCalledTimes(2)

    const [txData0, attemptNum0] = mockTrySendTransaction.mock.calls[0]
    expect(attemptNum0).toEqual(0)
    expect(txData0).toMatchSnapshot()

    const [txData1, attemptNum1] = mockTrySendTransaction.mock.calls[1]
    expect(attemptNum1).toEqual(1)
    expect(txData1).toMatchSnapshot()
  })

  test('timeout error', async () => {
    const balance = BigNumber.from(10 * 1000 * 1000)
    const nonce = 5
    const gasPrice = BigNumber.from(1000)
    const gasEstimate = BigNumber.from(10 * 1000)
    const txResponse = { foo: 'bar' }

    provider.getBalance.mockReturnValue(balance)
    provider.getTransactionCount.mockReturnValue(nonce)
    provider.getGasPrice.mockReturnValue(gasPrice)
    provider.estimateGas.mockReturnValue(gasEstimate)

    const mockTrySendTransaction = jest.fn()
    const mockConfirmTransactionSuccess = jest.fn()
    ethBc._trySendTransaction = mockTrySendTransaction
    ethBc._confirmTransactionSuccess = mockConfirmTransactionSuccess
    mockTrySendTransaction.mockReturnValue(txResponse)
    mockConfirmTransactionSuccess.mockRejectedValue({ code: ErrorCode.TIMEOUT })

    const cid = new CID('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
    await expect(ethBc.sendTransaction(cid)).rejects.toThrow('Failed to send transaction')

    expect(mockTrySendTransaction).toHaveBeenCalledTimes(MAX_RETRIES)
    expect(mockConfirmTransactionSuccess).toHaveBeenCalledTimes(MAX_RETRIES)
  })

  test('nonce expired error', async () => {
    // test what happens if a transaction is submitted, waiting for it to be mined times out, but
    // then before the retry the original txn gets mined, causing a NONCE_EXPIRED error on the retry
    const balance = BigNumber.from(10 * 1000 * 1000)
    const nonce = 5
    const gasPrice = BigNumber.from(1000)
    const gasEstimate = BigNumber.from(10 * 1000)
    const txResponses = [{ attempt: 1 }, { attempt: 2 }]
    const finalTransactionResult = { txHash: '0x12345' }

    provider.getBalance.mockReturnValue(balance)
    provider.getTransactionCount.mockReturnValue(nonce)
    provider.getGasPrice.mockReturnValue(gasPrice)
    provider.estimateGas.mockReturnValue(gasEstimate)

    const mockTrySendTransaction = jest.fn()
    const mockConfirmTransactionSuccess = jest.fn()
    ethBc._trySendTransaction = mockTrySendTransaction
    ethBc._confirmTransactionSuccess = mockConfirmTransactionSuccess
    // Successfully submit transaction
    mockTrySendTransaction.mockReturnValueOnce(txResponses[0])
    // Get timeout waiting for it to be mined
    mockConfirmTransactionSuccess.mockRejectedValueOnce({ code: ErrorCode.TIMEOUT })
    // Retry the transaction, submit it successfully
    mockTrySendTransaction.mockReturnValueOnce(txResponses[1])
    // Get timeout waiting for the second attempt as well
    mockConfirmTransactionSuccess.mockRejectedValueOnce({ code: ErrorCode.TIMEOUT })
    // On third attempt we get a NONCE_EXPIRED error because the first attempt was actually mined correctly
    mockTrySendTransaction.mockRejectedValueOnce({ code: ErrorCode.NONCE_EXPIRED })
    // Try to confirm the second attempt, get NONCE_EXPIRED because it was the first attempt that
    // was mined
    mockConfirmTransactionSuccess.mockRejectedValueOnce({ code: ErrorCode.NONCE_EXPIRED })
    // Try to confirm the original attempt, succeed
    mockConfirmTransactionSuccess.mockReturnValueOnce(finalTransactionResult)

    const cid = new CID('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
    await expect(ethBc.sendTransaction(cid)).resolves.toEqual(finalTransactionResult)

    expect(mockTrySendTransaction).toHaveBeenCalledTimes(3)
    expect(mockConfirmTransactionSuccess).toHaveBeenCalledTimes(4)
    expect(mockConfirmTransactionSuccess.mock.calls[0][0]).toEqual(txResponses[0])
    expect(mockConfirmTransactionSuccess.mock.calls[1][0]).toEqual(txResponses[1])
    expect(mockConfirmTransactionSuccess.mock.calls[2][0]).toEqual(txResponses[1])
    expect(mockConfirmTransactionSuccess.mock.calls[3][0]).toEqual(txResponses[0])
  })
})
