import CID from 'cids'

import { ErrorCode } from '@ethersproject/logger'

import { BigNumber, BigNumberish, ethers } from 'ethers'
import { Config } from 'node-config-ts'

import { logger, logEvent, logMetric } from '../../../logger'
import Transaction from '../../../models/transaction'
import BlockchainService from '../blockchain-service'
import {
  TransactionRequest,
  TransactionResponse,
  TransactionReceipt,
  FeeData,
} from '@ethersproject/abstract-provider'
import Utils from '../../../utils'

const BASE_CHAIN_ID = 'eip155'
const TX_FAILURE = 0
const TX_SUCCESS = 1
const NUM_BLOCKS_TO_WAIT = 4
export const MAX_RETRIES = 3

const POLLING_INTERVAL = 15 * 1000 // every 15 seconds

class WrongChainIdError extends Error {
  constructor(expected: number, actual: number) {
    super(
      `Chain ID of connected blockchain changed from ${caipChainId(expected)} to ${caipChainId(
        actual
      )}`
    )
  }
}

/**
 * Do up to +max+ attempts of an +operation+. Expect the +operation+ to return a defined value.
 * If no defined value is returned, iterate at most +max+ times.
 *
 * @param max - Maximum number of attempts.
 * @param operation - Operation to run.
 */
async function attempt<T>(
  max: number,
  operation: (attempt: number) => Promise<T | undefined | void>
): Promise<T> {
  let attempt = 0
  while (attempt < max) {
    const result = await operation(attempt)
    if (result) {
      return result
    }
    attempt++
    logger.warn(`Failed to send transaction; ${max - attempt} retries remain`)
    await Utils.delay(5000)
  }
  // All attempts spent
  throw new Error('Failed to send transaction')
}

/**
 * Throw if a transaction requires more funds than available.
 *
 * @param txData - Transaction to write.
 * @param walletBalance - Available funds.
 */
function handleInsufficientFundsError(txData: TransactionRequest, walletBalance: BigNumber): void {
  const txCost = (txData.gasLimit as BigNumber).mul(txData.maxFeePerGas)
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
}

/**
 * Represent chainId in CAIP format.
 * @param chainId - Numeric chain id.
 */
function caipChainId(chainId: number) {
  return `${BASE_CHAIN_ID}:${chainId}`
}

/**
 * Throw if +actual+ and +expected+ chain ids are not equal.
 *
 * @param actual - Chain id we received.
 * @param expected - Chain id we expect.
 */
function assertSameChainId(actual: number, expected: number) {
  if (actual != expected) {
    // TODO: This should be process-fatal
    throw new WrongChainIdError(expected, actual)
  }
}

/**
 * Just log a timeout error.
 */
function handleTimeoutError(transactionTimeoutSecs: number): void {
  logEvent.ethereum({
    type: 'transactionTimeout',
    transactionTimeoutSecs: transactionTimeoutSecs,
  })
  logger.err(`Transaction timed out after ${transactionTimeoutSecs} seconds without being mined`)
}

/**
 * Post `txRequest` event to a log. TransactionRequest contains `type` property which indicates
 * if it is a 1559 transaction. For logging, we effectively rename `type` property to `typ`.
 *
 * @param type - type of a log event: `txRequest` or `txReceipt`
 * @param tx - TransactionRequest.
 */
function logTransaction(
  type: 'txRequest' | 'txReceipt',
  tx: TransactionRequest | TransactionReceipt
) {
  const filtered = Object.assign<any, TransactionRequest | TransactionReceipt>({}, tx)
  filtered.typ = filtered.type
  delete filtered.type
  logEvent.ethereum({
    type: type,
    ...filtered,
  })
}

/**
 * Ethereum blockchain service
 */
export default class EthereumBlockchainService implements BlockchainService {
  private _chainId: number
  private readonly _network: string
  private readonly _transactionTimeoutSecs: number

  constructor(private readonly config: Config, private readonly wallet: ethers.Wallet) {
    this._network = this.config.blockchain.connectors.ethereum.network
    this._transactionTimeoutSecs = this.config.blockchain.connectors.ethereum.transactionTimeoutSecs
  }

  public static make(config: Config): EthereumBlockchainService {
    const ethereum = config.blockchain.connectors.ethereum
    const { host, port, url } = ethereum.rpc

    let provider
    if (url) {
      provider = new ethers.providers.JsonRpcProvider(url)
    } else if (host && port) {
      provider = new ethers.providers.JsonRpcProvider(`${host}:${port}`)
    } else {
      provider = ethers.getDefaultProvider(ethereum.network)
    }

    provider.pollingInterval = POLLING_INTERVAL
    const wallet = new ethers.Wallet(ethereum.account.privateKey, provider)
    return new EthereumBlockchainService(config, wallet)
  }

  /**
   * Connects to blockchain
   */
  public async connect(): Promise<void> {
    logger.imp(`Connecting to ${this._network} blockchain...`)
    await this._loadChainId()
    logger.imp(`Connected to ${this._network} blockchain with chain ID ${this.chainId}`)
  }

  /**
   * Returns a string representing the CAIP-2 ID of the configured blockchain by querying the
   * connected blockchain to ask for it.
   */
  private async _loadChainId(): Promise<void> {
    const network = await this.wallet.provider.getNetwork()
    this._chainId = network.chainId
  }

  /**
   * Sets the gas price for the transaction request.
   * For pre-1559 transaction we increase vanilla gasPrice by 10% each time. For a 1559 transaction, we increase maxPriorityFeePerGas,
   * again by 10% each time.
   *
   * For 1559 there are two parameters that can be set on a transaction: maxPriorityFeePerGas and maxFeePerGas.
   * maxFeePerGas should equal to `maxPriorityFeePerGas` (our tip to a miner) plus `baseFee` (ETH burned according to current network conditions).
   * To estimate the current parameters, we use `getFeeData` function, which returns two of our parameters.
   * Here we _can_ calculate `baseFee`, but also we can avoid doing that. Remember, we increase just `maxPriorityFeePerGas`.
   * Here we calculate a difference between previously sent `maxPriorityFeePerGas` and the increased one. It is our voluntary increase in gas price we agree to pay to mine our transaction.
   * We just add the difference to a currently estimated `maxFeePerGas` so that we conform to the equality `maxFeePerGas = baseFee + maxPriorityFeePerGas`.
   *
   * @param txData - transaction request data
   * @param attempt - what number attempt this is at submitting the transaction.  We increase
   *   the gas price we set by a 10% multiple with each subsequent attempt
   * @private
   */
  async setGasPrice(txData: TransactionRequest, attempt: number): Promise<void> {
    if (this.config.blockchain.connectors.ethereum.overrideGasConfig) {
      const feeData = await this.wallet.provider.getFeeData()
      const baseFee = feeData.maxFeePerGas.sub(feeData.maxPriorityFeePerGas)
      txData.maxPriorityFeePerGas = BigNumber.from(
        this.config.blockchain.connectors.ethereum.maxPriorityFeePerGas
      )
      txData.maxFeePerGas = baseFee.add(txData.maxPriorityFeePerGas)
      logger.debug(
        'Overriding Gas price: max priority fee:' + txData.maxPriorityFeePerGas.toString()
      )

      txData.gasLimit = BigNumber.from(this.config.blockchain.connectors.ethereum.gasLimit)
      logger.debug('Overriding Gas limit: ' + txData.gasLimit.toString())
    } else {
      const feeData = await this.wallet.provider.getFeeData()
      // Add extra to gas price for each subsequent attempt
      const prevMaxPriorityFeePerGas = BigNumber.from(
        txData.maxPriorityFeePerGas || feeData.gasPrice
      )
      const nextMaxPriorityFeePerGas = EthereumBlockchainService.increaseGasPricePerAttempt(
        feeData,
        attempt,
        prevMaxPriorityFeePerGas
      )
      const is1559 = Boolean(feeData.maxFeePerGas && feeData.maxPriorityFeePerGas)
      if (is1559) {
        const priorityFeeDifference = nextMaxPriorityFeePerGas.sub(prevMaxPriorityFeePerGas)
        txData.maxFeePerGas = feeData.maxFeePerGas.add(priorityFeeDifference)
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
   * Take current gas price (or maxPriorityFeePerGas for 1559 transaction), and attempt number,
   * and return new gas price (or maxPriorityFeePerGas for 1559 transaction) with 10% increase per attempt.
   * If this isn't the first attempt, also ensures that the new gas is at least 10% greater than the
   * previous attempt's gas, even if the gas price on chain has gone down since then. This is because
   * retries of the same transaction (using the same nonce) need to have a gas price at least 10% higher
   * than any previous attempts or the transaction will fail.
   *
   * @param feeData - Currently estimated gas price (contains both pre-1559 gasPrice and 1559-related parameters)
   * @param attempt - Index of a current attempt, starts with 0.
   * @param previousGas - Either gasPrice for pre-1559 tx or maxPriorityFeePerGas for 1559 tx.
   */
  static increaseGasPricePerAttempt(
    feeData: FeeData,
    attempt: number,
    previousGas: BigNumberish | undefined
  ): BigNumber {
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || feeData.gasPrice
    const increase = maxPriorityFeePerGas.div(10).mul(attempt) // 10% increase
    const newGas = maxPriorityFeePerGas.add(increase)

    if (attempt == 0 || previousGas == undefined) {
      return newGas
    }
    const previousGasBN = BigNumber.from(previousGas)
    const minGas = previousGasBN.add(previousGasBN.div(10)) // +10%
    return newGas.gt(minGas) ? newGas : minGas
  }

  /**
   * Returns the cached 'chainId' representing the CAIP-2 ID of the configured blockchain.
   * Invalid to call before calling connect()
   */
  public get chainId(): string {
    return caipChainId(this._chainId)
  }

  async _buildTransactionRequest(rootCid: CID): Promise<TransactionRequest> {
    const rootStrHex = rootCid.toString('base16')
    const hexEncoded = '0x' + (rootStrHex.length % 2 == 0 ? rootStrHex : '0' + rootStrHex)
    logger.imp(`Hex encoded root CID ${hexEncoded}`)

    logger.debug('Preparing ethereum transaction')
    const baseNonce = await this.wallet.provider.getTransactionCount(this.wallet.address)

    const txData: TransactionRequest = {
      to: this.wallet.address,
      data: hexEncoded,
      nonce: baseNonce,
    }
    return txData
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

    logTransaction('txRequest', txData)
    logger.imp(`Sending transaction to Ethereum ${this._network} network...`)
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

    assertSameChainId(txResponse.chainId, this._chainId)
    return txResponse
  }

  /**
   * Queries the blockchain to see if the submitted transaction was successfully mined, and returns
   * the transaction info if so.
   * @param txResponse - response from when the transaction was submitted to the mempool
   */
  async _confirmTransactionSuccess(txResponse: TransactionResponse): Promise<Transaction> {
    logger.imp(`Waiting to confirm transaction with hash ${txResponse.hash}`)
    const txReceipt: TransactionReceipt = await this.wallet.provider.waitForTransaction(
      txResponse.hash,
      NUM_BLOCKS_TO_WAIT,
      this._transactionTimeoutSecs * 1000
    )
    logTransaction('txReceipt', txReceipt)
    const block = await this.wallet.provider.getBlock(txReceipt.blockHash)

    const status = txReceipt.byzantium ? txReceipt.status : -1
    let statusMessage = status == TX_SUCCESS ? 'success' : 'failure'
    if (!txReceipt.byzantium) {
      statusMessage = 'unknown'
    }
    logger.imp(
      `Transaction completed on Ethereum ${this._network} network. Transaction hash: ${txReceipt.transactionHash}. Status: ${statusMessage}.`
    )
    if (status == TX_FAILURE) {
      throw new Error('Transaction completed with a failure status')
    }

    return new Transaction(
      this.chainId,
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
    const txData = await this._buildTransactionRequest(rootCid)
    const txResponses: Array<TransactionResponse> = []

    return this.withWalletBalance((walletBalance) => {
      return attempt(MAX_RETRIES, async (attemptNum) => {
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
              handleInsufficientFundsError(txData, walletBalance)
            } else if (code === ErrorCode.TIMEOUT) {
              handleTimeoutError(this._transactionTimeoutSecs)
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
              return this._checkForPreviousTransactionSuccess(txResponses)
            }
          }
        }
      })
    })
  }

  /**
   * Report wallet balance before and after +operation+.
   * @param operation
   */
  private async withWalletBalance<T>(operation: (balance: BigNumber) => Promise<T>): Promise<T> {
    const startingWalletBalance = await this.wallet.provider.getBalance(this.wallet.address)
    logMetric.ethereum({
      type: 'walletBalance',
      balance: ethers.utils.formatUnits(startingWalletBalance, 'gwei'),
    })
    logger.imp(`Current wallet balance is ` + startingWalletBalance)

    const result = await operation(startingWalletBalance)

    const endingWalletBalance = await this.wallet.provider.getBalance(this.wallet.address)
    logMetric.ethereum({
      type: 'walletBalance',
      balance: ethers.utils.formatUnits(endingWalletBalance, 'gwei'),
    })
    return result
  }
}
