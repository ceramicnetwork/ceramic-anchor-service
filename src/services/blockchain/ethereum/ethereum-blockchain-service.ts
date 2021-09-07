import CID from 'cids'

import * as providers from '@ethersproject/providers'
import { ErrorCode } from '@ethersproject/logger'

import { BigNumber, BigNumberish, ethers } from 'ethers'
import { Config } from 'node-config-ts'

import { logger, logEvent, logMetric } from '../../../logger'
import Transaction from '../../../models/transaction'
import BlockchainService from '../blockchain-service'
import type { TransactionRequest, TransactionResponse } from '@ethersproject/abstract-provider'
import Utils from '../../../utils'

const BASE_CHAIN_ID = 'eip155'
const TX_FAILURE = 0
const TX_SUCCESS = 1
const NUM_BLOCKS_TO_WAIT = 4
export const MAX_RETRIES = 3

const POLLING_INTERVAL = 15 * 1000 // every 15 seconds

/**
 * Ethereum blockchain service
 */
export default class EthereumBlockchainService implements BlockchainService {
  private _chainId: string
  private readonly network: string
  private readonly transactionTimeoutSecs: number

  constructor(private readonly config: Config, private readonly wallet: ethers.Wallet) {
    this.network = config.blockchain.connectors.ethereum.network
    this.transactionTimeoutSecs = this.config.blockchain.connectors.ethereum.transactionTimeoutSecs
  }

  public static make(config: Config): EthereumBlockchainService {
    const { network } = config.blockchain.connectors.ethereum
    const { host, port, url } = config.blockchain.connectors.ethereum.rpc

    let provider
    if (url) {
      provider = new ethers.providers.JsonRpcProvider(url)
    } else if (host && port) {
      provider = new ethers.providers.JsonRpcProvider(`${host}:${port}`)
    } else {
      provider = ethers.getDefaultProvider(network)
    }

    provider.pollingInterval = POLLING_INTERVAL
    const wallet = new ethers.Wallet(
      config.blockchain.connectors.ethereum.account.privateKey,
      provider
    )
    return new EthereumBlockchainService(config, wallet)
  }

  /**
   * Connects to blockchain
   */
  public async connect(): Promise<void> {
    logger.imp('Connecting to ' + this.network + ' blockchain...')
    await this._loadChainId()
    logger.imp('Connected to ' + this.network + ' blockchain with chain ID ' + this.chainId)
  }

  /**
   * Returns a string representing the CAIP-2 ID of the configured blockchain by querying the
   * connected blockchain to ask for it.
   */
  private async _loadChainId(): Promise<void> {
    const idnum = (await this.wallet.provider.getNetwork()).chainId
    this._chainId = BASE_CHAIN_ID + ':' + idnum
  }

  /**
   * Returns the cached 'chainId' representing the CAIP-2 ID of the configured blockchain.
   * Invalid to call before calling connect()
   */
  public get chainId(): string {
    return this._chainId
  }

  /**
   * Sets the gas price for the transaction request
   * @param txData - transaction request data
   * @param attempt - what number attempt this is at submitting the transaction.  We increase
   *   the gas price we set by a 10% multiple with each subsequent attempt
   * @private
   */
  async setGasPrice(txData: TransactionRequest, attempt: number): Promise<void> {
    if (this.config.blockchain.connectors.ethereum.overrideGasConfig) {
      const feeData = await this.wallet.provider.getFeeData()
      const baseFee = feeData.maxFeePerGas.sub(feeData.maxPriorityFeePerGas)
      txData.maxPriorityFeePerGas = BigNumber.from(this.config.blockchain.connectors.ethereum.maxPriorityFeePerGas)
      txData.maxFeePerGas = baseFee.add(txData.maxPriorityFeePerGas)
      logger.debug('Overriding Gas price: max priority fee:' + txData.maxPriorityFeePerGas.toString())

      txData.gasLimit = BigNumber.from(this.config.blockchain.connectors.ethereum.gasLimit)
      logger.debug('Overriding Gas limit: ' + txData.gasLimit.toString())
    } else {
      const feeData = await this.wallet.provider.getFeeData()
      // Add extra to gas price for each subsequent attempt
      const prevMaxPriorityFeePerGas = BigNumber.from(txData.maxPriorityFeePerGas || 0)
      const nextMaxPriorityFeePerGas = EthereumBlockchainService.increaseGasPricePerAttempt(
        feeData,
        attempt,
        prevMaxPriorityFeePerGas
      )
      const difference = nextMaxPriorityFeePerGas.sub(prevMaxPriorityFeePerGas)
      if (feeData.maxPriorityFeePerGas) {
        txData.maxFeePerGas = feeData.maxFeePerGas.add(difference)
        txData.maxPriorityFeePerGas = nextMaxPriorityFeePerGas
      } else {
        txData.gasPrice = nextMaxPriorityFeePerGas
      }
      logger.debug(
        'Estimated maxPriorityFeePerGas (in wei): ' + nextMaxPriorityFeePerGas.toString()
      )

      txData.gasLimit = await this.wallet.provider.estimateGas(txData)
      logger.debug('Estimated Gas limit: ' + txData.gasLimit.toString())
    }
  }

  /**
   * Takes current gas price and attempt number and returns new gas price with 10% increase per attempt.
   * If this isn't the first attempt, also ensures that the new gas is at least 10% greater than the
   * previous attempt's gas, even if the gas price on chain has gone down since then. This is because
   * retries of the same transaction (using the same nonce) need to have a gas price at least 10% higher
   * than any previous attempts or the transaction will fail.
   * @param feeData
   * @param attempt
   * @param previousGas
   */
  static increaseGasPricePerAttempt(
    feeData: providers.FeeData,
    attempt: number,
    previousGas: BigNumberish | undefined
  ): BigNumber {
    // Ganache still does not support 1559, so here is a workaround
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || feeData.gasPrice
    // Ethers BigNumber does not support non-integer numbers for operations
    const decimalPart = maxPriorityFeePerGas.div(10)
    const increase = decimalPart.mul(attempt)
    const newGas = maxPriorityFeePerGas.add(increase)
    if (attempt == 0 || previousGas == undefined) {
      return newGas
    }

    const previousGasBN = BigNumber.from(previousGas)
    const previousGasDecimalPart = previousGasBN.div(10)
    const minGas = previousGasBN.add(previousGasDecimalPart)
    return newGas.gt(minGas) ? newGas : minGas
  }

  async _buildTransactionRequest(rootCid: CID): Promise<TransactionRequest> {
    const rootStrHex = rootCid.toString('base16')
    const hexEncoded = '0x' + (rootStrHex.length % 2 == 0 ? rootStrHex : '0' + rootStrHex)
    logger.imp(`Hex encoded root CID ${hexEncoded}`)

    logger.debug('Preparing ethereum transaction')
    const baseNonce = await this.wallet.provider.getTransactionCount(this.wallet.address)

    return {
      to: this.wallet.address,
      data: hexEncoded,
      nonce: baseNonce,
    }
  }

  /**
   * One attempt at submitting the prepared TransactionRequest to the ethereum blockchain.
   * @param txData
   * @param attemptNum
   */
  async _trySendTransaction(
    txData: TransactionRequest,
    attemptNum: number
  ): Promise<TransactionResponse> {
    logger.imp('Transaction data:' + JSON.stringify(txData))

    const loggableTxData = Object.assign({}, txData)
    delete loggableTxData.type
    logEvent.ethereum({
      type: 'txRequest',
      ...(loggableTxData as Omit<TransactionRequest, 'type'>),
    })
    logger.imp(`Sending transaction to Ethereum ${this.network} network...`)
    const txResponse: TransactionResponse = await this.wallet.sendTransaction(txData)
    logEvent.ethereum({
      type: 'txResponse',
      hash: txResponse.hash,
      blockNumber: txResponse.blockNumber,
      blockHash: txResponse.blockHash,
      timestamp: txResponse.timestamp,
      confirmations: txResponse.confirmations,
      from: txResponse.from,
      raw: txResponse.raw,
    })

    return txResponse
  }

  /**
   * Queries the blockchain to see if the submitted transaction was successfully mined, and returns
   * the transaction info if so.
   * @param txResponse - response from when the transaction was submitted to the mempool
   */
  async _confirmTransactionSuccess(txResponse: TransactionResponse): Promise<Transaction> {
    const caip2ChainId = 'eip155:' + txResponse.chainId
    if (caip2ChainId != this.chainId) {
      // TODO: This should be process-fatal
      throw new Error(
        'Chain ID of connected blockchain changed from ' + this.chainId + ' to ' + caip2ChainId
      )
    }

    logger.imp(`Waiting to confirm transaction with hash ${txResponse.hash}`)
    const txReceipt: providers.TransactionReceipt = await this.wallet.provider.waitForTransaction(
      txResponse.hash,
      NUM_BLOCKS_TO_WAIT,
      this.transactionTimeoutSecs * 1000
    )
    const loggableReceipt = Object.assign({}, txReceipt)
    delete loggableReceipt.type
    logEvent.ethereum({
      type: 'txReceipt',
      ...(txReceipt as Omit<TransactionRequest, 'type'>),
    })
    const block: providers.Block = await this.wallet.provider.getBlock(txReceipt.blockHash)

    const status = txReceipt.byzantium ? txReceipt.status : -1
    let statusMessage = status == TX_SUCCESS ? 'success' : 'failure'
    if (!txReceipt.byzantium) {
      statusMessage = 'unknown'
    }
    logger.imp(
      `Transaction completed on Ethereum ${this.network} network. Transaction hash: ${txReceipt.transactionHash}. Status: ${statusMessage}.`
    )
    if (status == TX_FAILURE) {
      throw new Error('Transaction completed with a failure status')
    }

    return new Transaction(
      caip2ChainId,
      txReceipt.transactionHash,
      txReceipt.blockNumber,
      block.timestamp
    )
  }

  /**
   * Queries the blockchain to see if any of the previously submitted transactions that had timed
   * out went on to be successfully mined, and returns the transaction info if so.
   * @param txResponses - responses from previous transaction submissions.
   */
  async _checkForPreviousTransactionSuccess(
    txResponses: Array<TransactionResponse>
  ): Promise<Transaction> {
    for (let i = txResponses.length - 1; i >= 0; i--) {
      try {
        return await this._confirmTransactionSuccess(txResponses[i])
      } catch (err) {
        logger.err(err)
      }
    }
    throw new Error('Failed to confirm any previous transaction attempts')
  }

  /**
   * Sends transaction with root CID as data
   */
  public async sendTransaction(rootCid: CID): Promise<Transaction> {
    return this.withWalletBalance(async (walletBalance) => {
      const txData = await this._buildTransactionRequest(rootCid)

      let attemptNum = 0
      const txResponses: Array<TransactionResponse> = []
      while (attemptNum < MAX_RETRIES) {
        try {
          await this.setGasPrice(txData, attemptNum)

          const txResponse = await this._trySendTransaction(txData, attemptNum)
          txResponses.push(txResponse)
          return await this._confirmTransactionSuccess(txResponse)
        } catch (err) {
          logger.err(err)

          const { code } = err
          if (code) {
            if (code === ErrorCode.INSUFFICIENT_FUNDS) {
              const gasPrice = txData.maxFeePerGas || txData.gasPrice
              const txCost = (txData.gasLimit as BigNumber).mul(gasPrice)
              if (txCost.gt(walletBalance)) {
                logEvent.ethereum({
                  type: 'insufficientFunds',
                  txCost: txCost,
                  balance: ethers.utils.formatUnits(walletBalance, 'gwei'),
                })

                const errMsg =
                  'Transaction cost is greater than our current balance. [txCost: ' +
                  txCost.toHexString() +
                  ', balance: ' +
                  walletBalance.toHexString() +
                  ']'
                logger.err(errMsg)
                throw new Error(errMsg)
              }
            } else if (code === ErrorCode.TIMEOUT) {
              logEvent.ethereum({
                type: 'transactionTimeout',
                transactionTimeoutSecs: this.transactionTimeoutSecs,
              })
              logger.err(
                `Transaction timed out after ${this.transactionTimeoutSecs} seconds without being mined`
              )
              // Fall through and retry if we have retries remaining
            } else if (code === ErrorCode.NONCE_EXPIRED) {
              // If this happens it most likely means that one of our previous attempts timed out, but
              // then actually wound up being successfully mined
              logEvent.ethereum({
                type: 'nonceExpired',
                nonce: txData.nonce,
              })
              if (attemptNum == 0 || txResponses.length == 0) {
                throw err
              }

              return await this._checkForPreviousTransactionSuccess(txResponses)
            }
          }

          attemptNum++
          if (attemptNum >= MAX_RETRIES) {
            throw new Error('Failed to send transaction')
          } else {
            logger.warn(`Failed to send transaction; ${MAX_RETRIES - attemptNum} retries remain`)
            await Utils.delay(5000)
          }
        }
      }
    })
  }

  async withWalletBalance<T>(action: (balance: BigNumber) => Promise<T>): Promise<T> {
    const before = await this.wallet.provider.getBalance(this.wallet.address)
    logMetric.ethereum({
      type: 'walletBalance',
      balance: ethers.utils.formatUnits(before, 'gwei'),
    })
    logger.imp(`Current wallet balance is ` + before)

    const result = await action(before)

    const after = await this.wallet.provider.getBalance(this.wallet.address)
    logMetric.ethereum({
      type: 'walletBalance',
      balance: ethers.utils.formatUnits(after, 'gwei'),
    })
    return result
  }
}
