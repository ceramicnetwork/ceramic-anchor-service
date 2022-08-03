import 'reflect-metadata'
import { jest } from '@jest/globals'
import { CID } from 'multiformats/cid'
import Ganache from 'ganache-core'
import { config, Config } from 'node-config-ts'
import { logger } from '../../../logger/index.js'
import { ethers } from 'ethers'
import { container, instanceCachingFactory } from 'tsyringe'
import { BlockchainService } from '../blockchain-service.js'
import { EthereumBlockchainService, MAX_RETRIES } from '../ethereum/ethereum-blockchain-service.js'
import { BigNumber } from 'ethers'
import type { FeeData } from '@ethersproject/abstract-provider'
import { ErrorCode } from '@ethersproject/logger'
import fs from 'fs'
import getPort from 'get-port'
import cloneDeep from 'lodash.clonedeep'

const deployContract = async (
  provider: ethers.providers.JsonRpcProvider
): Promise<ethers.Contract> => {
  const wallet = new ethers.Wallet(
    config.blockchain.connectors.ethereum.account.privateKey,
    provider
  )

  const contractData = JSON.parse(
    fs
      .readFileSync(
        new URL(
          '../../../../contracts/out/CeramicAnchorServiceV2.sol/CeramicAnchorServiceV2.json',
          import.meta.url
        )
      )
      .toString()
  )

  const factory = new ethers.ContractFactory(contractData.abi, contractData.bytecode.object, wallet)
  const contract = await factory.deploy()
  await contract.deployed()

  return contract
}

describe('ETH service connected to ganache', () => {
  jest.setTimeout(25000)
  const blockchainStartTime = new Date(1586784002000)
  let ganacheServer: Ganache.Server
  let ethBc: BlockchainService
  let testConfig: Config
  let providerForGanache: ethers.providers.JsonRpcProvider
  let contract: ethers.Contract

  beforeAll(async () => {
    const port = await getPort()

    ganacheServer = Ganache.server({
      gasLimit: 7000000,
      time: blockchainStartTime,
      mnemonic: 'move sense much taxi wave hurry recall stairs thank brother nut woman',
      default_balance_ether: 100,
      debug: true,
      blockTime: 2,
      network_id: 1337,
      port,
    })
    await ganacheServer.listen(port)
    providerForGanache = new ethers.providers.JsonRpcProvider(`http://localhost:${port}`)
    contract = await deployContract(providerForGanache)

    testConfig = cloneDeep(config)
    testConfig.blockchain.connectors.ethereum.rpc.port = port.toString()
    testConfig.blockchain.connectors.ethereum.contractAddress = contract.address
    testConfig.useSmartContractAnchors = false

    container.register('blockchainService', {
      useFactory: instanceCachingFactory<EthereumBlockchainService>((c) =>
        EthereumBlockchainService.make(testConfig)
      ),
    })
    ethBc = container.resolve<BlockchainService>('blockchainService')
    await ethBc.connect()
  })

  afterAll(async () => {
    logger.imp(`Closing local Ethereum blockchain instance...`)
    ganacheServer.close()
  })

  describe('v0', () => {
    test('should send CID to local ganache server', async () => {
      const block = await providerForGanache.getBlock(await providerForGanache.getBlockNumber())
      const startTimestamp = block.timestamp

      const cid = CID.parse('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
      const tx = await ethBc.sendTransaction(cid)
      expect(tx).toBeDefined()

      // checking the timestamp against the snapshot is too brittle since if the test runs slowly it
      // can be off slightly.  So we test it manually here instead.
      const blockTimestamp = tx.blockTimestamp
      delete tx.blockTimestamp
      expect(blockTimestamp).toBeGreaterThan(startTimestamp)
      expect(blockTimestamp).toBeLessThan(startTimestamp + 5)

      expect(tx).toMatchSnapshot()
    })

    test('can fetch chainId properly', async () => {
      const chainId = ethBc.chainId
      expect(chainId).toEqual('eip155:1337')
    })

    test('gas price increase math', () => {
      const gasEstimate: FeeData = {
        maxFeePerGas: BigNumber.from(2000),
        maxPriorityFeePerGas: BigNumber.from(1000),
        gasPrice: BigNumber.from(0),
      }
      const firstRetry = BigNumber.from(1100)
      // Note that this is not 1200. It needs to be 10% over the previous attempt's gas,
      // not 20% over the gas estimate
      const secondRetry = BigNumber.from(1210)
      expect(
        EthereumBlockchainService.increaseGasPricePerAttempt(
          gasEstimate.maxPriorityFeePerGas,
          0,
          undefined
        ).toNumber()
      ).toEqual(gasEstimate.maxPriorityFeePerGas.toNumber())
      expect(
        EthereumBlockchainService.increaseGasPricePerAttempt(
          gasEstimate.maxPriorityFeePerGas,
          1,
          gasEstimate.maxPriorityFeePerGas
        ).toNumber()
      ).toEqual(firstRetry.toNumber())
      expect(
        EthereumBlockchainService.increaseGasPricePerAttempt(
          gasEstimate.maxPriorityFeePerGas,
          2,
          firstRetry
        ).toNumber()
      ).toEqual(secondRetry.toNumber())
    })
  })

  describe('v1', () => {
    beforeAll(() => {
      testConfig.useSmartContractAnchors = true
    })

    afterAll(() => {
      testConfig.useSmartContractAnchors = false
    })

    test('should anchor to contract', async () => {
      const block = await providerForGanache.getBlock(await providerForGanache.getBlockNumber())
      const startTimestamp = block.timestamp

      const cid = CID.parse('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
      const tx = await ethBc.sendTransaction(cid)
      expect(tx).toBeDefined()
      const txReceipt = await providerForGanache.getTransactionReceipt(tx.txHash)
      const contractEvents = txReceipt.logs.map((log) => contract.interface.parseLog(log))

      expect(contractEvents.length).toEqual(1)
      expect(contractEvents[0].name).toEqual('DidAnchor')

      // checking the values against the snapshot is too brittle since ganache is time based so we test manually
      expect(tx.blockTimestamp).toBeGreaterThan(startTimestamp)
      expect(tx.blockTimestamp).toBeLessThan(startTimestamp + 5)
      expect(tx.blockNumber).toBe(block.number + 1)
      expect(tx.txHash).toEqual(
        '0xe6526786001e9eb2247e833ca78c1a2761b0d0de3fa58b9a6b95e40dbb7f3a0a'
      )
    })
  })
})

describe('setGasPrice', () => {
  const cid = CID.parse('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
  const feeData = {
    maxFeePerGas: BigNumber.from(2000),
    maxPriorityFeePerGas: BigNumber.from(1000),
    gasPrice: BigNumber.from(1000),
  }
  const gasLimit = BigNumber.from(10)
  const provider = {
    estimateGas: jest.fn(() => gasLimit),
    getNetwork: jest.fn(() => ({ chainId: '1337' })),
    getTransactionCount: jest.fn(),
    getFeeData: jest.fn(() => feeData),
  }

  const buildBlockchainService = async (provider: any): Promise<EthereumBlockchainService> => {
    const wallet = {
      address: 'abcd1234',
      provider: provider,
      sendTransaction: jest.fn(),
    }
    const ethBc = new EthereumBlockchainService(config, wallet as any)
    await ethBc.connect()
    return ethBc
  }

  test('legacy transaction', async () => {
    const legacyProvider = Object.assign({}, provider, {
      getFeeData: jest.fn(() => ({ gasPrice: feeData.gasPrice })),
    })
    const ethBc = await buildBlockchainService(legacyProvider)
    const txData = await ethBc._buildTransactionRequest(cid)
    for (const attempt of [0, 1, 2]) {
      await ethBc.setGasPrice(txData, attempt)
      expect(txData).toMatchSnapshot()
    }
  })

  test('EIP1559 transaction', async () => {
    const ethBc = await buildBlockchainService(provider)
    const txData = await ethBc._buildTransactionRequest(cid)
    for (const attempt of [0, 1, 2]) {
      await ethBc.setGasPrice(txData, attempt)
      expect(txData).toMatchSnapshot()
    }
  })
})

describe('ETH service with mock wallet', () => {
  let ethBc: EthereumBlockchainService
  const provider = {
    estimateGas: jest.fn(),
    getBalance: jest.fn(),
    getBlock: jest.fn(),
    getGasPrice: jest.fn(),
    getNetwork: jest.fn(),
    getTransactionCount: jest.fn(),
    waitForTransaction: jest.fn(),
    getFeeData: jest.fn(),
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

    const cid = CID.parse('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
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
    const feeData = {
      maxFeePerGas: BigNumber.from(2000),
      maxPriorityFeePerGas: BigNumber.from(1000),
      gasPrice: BigNumber.from(1000),
    }
    const gasEstimate = BigNumber.from(10 * 1000)
    const txResponse = { foo: 'bar' }
    const finalTransactionResult = { txHash: '0x12345' }

    provider.getBalance.mockReturnValue(balance)
    provider.getTransactionCount.mockReturnValue(nonce)
    provider.getGasPrice.mockReturnValue(feeData.gasPrice)
    provider.estimateGas.mockReturnValue(gasEstimate)
    provider.getFeeData.mockReturnValue(feeData)

    const mockTrySendTransaction = jest.fn()
    const mockConfirmTransactionSuccess = jest.fn()
    ethBc._trySendTransaction = mockTrySendTransaction as jest.Mocked<
      typeof ethBc._trySendTransaction
    >
    ethBc._confirmTransactionSuccess = mockConfirmTransactionSuccess as jest.Mocked<
      typeof ethBc._confirmTransactionSuccess
    >
    mockTrySendTransaction.mockReturnValue(txResponse)
    mockConfirmTransactionSuccess.mockReturnValue(finalTransactionResult)
    const cid = CID.parse('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
    await expect(ethBc.sendTransaction(cid)).resolves.toEqual(finalTransactionResult)

    expect(mockTrySendTransaction).toHaveBeenCalledTimes(1)
    const [txData] = mockTrySendTransaction.mock.calls[0]
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
    const feeData = {
      maxFeePerGas: BigNumber.from(2000),
      maxPriorityFeePerGas: BigNumber.from(1000),
      gasPrice: BigNumber.from(1000),
    }

    provider.getBalance.mockReturnValue(balance)
    provider.getTransactionCount.mockReturnValue(nonce)
    provider.getGasPrice.mockReturnValue(gasPrice)
    provider.estimateGas.mockReturnValue(gasEstimate)
    provider.getFeeData.mockReturnValue(feeData)

    const mockTrySendTransaction = jest.fn()
    ethBc._trySendTransaction = mockTrySendTransaction as jest.Mocked<
      typeof ethBc._trySendTransaction
    >
    mockTrySendTransaction
      .mockRejectedValueOnce({ code: ErrorCode.TIMEOUT })
      .mockRejectedValueOnce({ code: ErrorCode.INSUFFICIENT_FUNDS })

    const cid = CID.parse('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
    await expect(ethBc.sendTransaction(cid)).rejects.toThrow(
      /Transaction cost is greater than our current balance/
    )

    // In the first attempt we have exactly enough balance in our wallet to cover the cost, but the
    // transaction times out. On retry, the gas cost is increased and goes over the wallet balance,
    // causing the attempt to be aborted.
    expect(mockTrySendTransaction).toHaveBeenCalledTimes(2)

    const [txData0] = mockTrySendTransaction.mock.calls[0]
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
    const feeData = {
      maxFeePerGas: BigNumber.from(2000),
      maxPriorityFeePerGas: BigNumber.from(1000),
      gasPrice: BigNumber.from(1000),
    }

    provider.getBalance.mockReturnValue(balance)
    provider.getTransactionCount.mockReturnValue(nonce)
    provider.getGasPrice.mockReturnValue(gasPrice)
    provider.estimateGas.mockReturnValue(gasEstimate)
    provider.getFeeData.mockReturnValue(feeData)

    const mockTrySendTransaction = jest.fn()
    const mockConfirmTransactionSuccess = jest.fn()
    ethBc._trySendTransaction = mockTrySendTransaction as jest.Mocked<
      typeof ethBc._trySendTransaction
    >
    ethBc._confirmTransactionSuccess = mockConfirmTransactionSuccess as jest.Mocked<
      typeof ethBc._confirmTransactionSuccess
    >
    mockTrySendTransaction.mockReturnValue(txResponse)
    mockConfirmTransactionSuccess.mockRejectedValue({ code: ErrorCode.TIMEOUT })

    const cid = CID.parse('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
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
    const feeData = {
      maxFeePerGas: BigNumber.from(2000),
      maxPriorityFeePerGas: BigNumber.from(1000),
      gasPrice: BigNumber.from(1000),
    }

    provider.getBalance.mockReturnValue(balance)
    provider.getTransactionCount.mockReturnValue(nonce)
    provider.getGasPrice.mockReturnValue(gasPrice)
    provider.estimateGas.mockReturnValue(gasEstimate)
    provider.getFeeData.mockReturnValue(feeData)

    const mockTrySendTransaction = jest.fn()
    const mockConfirmTransactionSuccess = jest.fn()
    ethBc._trySendTransaction = mockTrySendTransaction as jest.Mocked<
      typeof ethBc._trySendTransaction
    >
    ethBc._confirmTransactionSuccess = mockConfirmTransactionSuccess as jest.Mocked<
      typeof ethBc._confirmTransactionSuccess
    >
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

    const cid = CID.parse('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
    await expect(ethBc.sendTransaction(cid)).resolves.toEqual(finalTransactionResult)

    expect(mockTrySendTransaction).toHaveBeenCalledTimes(3)
    expect(mockConfirmTransactionSuccess).toHaveBeenCalledTimes(4)
    expect(mockConfirmTransactionSuccess.mock.calls[0][0]).toEqual(txResponses[0])
    expect(mockConfirmTransactionSuccess.mock.calls[1][0]).toEqual(txResponses[1])
    expect(mockConfirmTransactionSuccess.mock.calls[2][0]).toEqual(txResponses[1])
    expect(mockConfirmTransactionSuccess.mock.calls[3][0]).toEqual(txResponses[0])
  })
})
