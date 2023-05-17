import {ContractParameters, EthereumClient, TransactionReceipt} from "./ethereum-client.js";
import {Address, parseAbi, toHex} from "viem";
import {CID} from "multiformats/cid";
import {EthereumWallet} from "./ethereum-wallet.js";
import {backOff, BackoffOptions} from "exponential-backoff"
import { logger, logEvent } from '../../../logger/index.js'
import {Transaction} from "../../../models/transaction.js";

const FUNCTION_NAME = "anchorDagCbor" as const
const ABI = parseAbi([`function ${FUNCTION_NAME}(bytes32)`])

class PreviousAttempt {
  attemptNum: number
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint

  constructor(baseFeePerGas: bigint) {
    this.attemptNum = 0

    this.maxPriorityFeePerGas = 1_500_000_000n // 1.5 gwei
    this.maxFeePerGas = this.calculateMaxFeePerGas(baseFeePerGas)
  }

  calculateMaxFeePerGas(baseFeePerGas: bigint): bigint {
    return (baseFeePerGas * 120n) / 100n + this.maxPriorityFeePerGas
  }

  increment(baseFeePerGas: bigint) {
    this.attemptNum += 1
    const increment = (100n + 10n * BigInt(this.attemptNum)) / 100n
    this.maxPriorityFeePerGas = this.maxPriorityFeePerGas * increment
    this.maxFeePerGas = this.calculateMaxFeePerGas(baseFeePerGas)
  }
}

interface GetFeeHistory {
  tag: 'fee_history'
}

interface SimulateContract {
  tag: 'simulate'
  opts: ContractParameters
}

interface WriteContract {
  tag: 'write'
  opts: ContractParameters
}

interface GetTransactionReceipt {
  tag: 'get_transaction'
  transaction: Address
}

interface GetBlock {
  tag: 'get_block'
  transaction: TransactionReceipt
}

const MAX_ATTEMPTS = 3

const BACKOFF_OPTIONS: BackoffOptions = {
  numOfAttempts: MAX_ATTEMPTS,
  delayFirstAttempt: false,
  startingDelay: 1_000, //delay in ms
  retry: (e, attemptNumber) => {
    logger.warn(`Failed to send transaction, attempt ${attemptNumber} of ${MAX_ATTEMPTS}: ${e}`)
    return true
  }
}

type TransactionState = GetFeeHistory | SimulateContract | WriteContract | GetTransactionReceipt | GetBlock
export class TransactionStateMachine {
  private readonly rootCid: CID
  private previousAttempt?: PreviousAttempt
  private state: TransactionState
  private provider: EthereumClient
  private wallet: EthereumWallet
  private readonly contractAddress: Address
  private readonly chainId: string

  constructor(chainId: string, provider: EthereumClient, wallet: EthereumWallet, contractAddress: Address, rootCid: CID) {
    this.chainId = chainId
    this.provider = provider
    this.wallet = wallet
    this.contractAddress = contractAddress
    this.rootCid = rootCid
    this.state = {
      tag: 'fee_history'
    }
  }

  async getFeeHistory(): Promise<void> {
    const fees = await backOff(() => this.provider.getFeeHistory(), BACKOFF_OPTIONS)
    const baseFeePerGas = fees.baseFeePerGas
    let previousAttempt = this.previousAttempt
    if (!previousAttempt) {
      previousAttempt = new PreviousAttempt(baseFeePerGas)
    } else {
      previousAttempt.increment(baseFeePerGas)
    }
    const data = toHex(this.rootCid.bytes.slice(4))
    const opts = {
      abi: ABI,
      functionName: FUNCTION_NAME,
      account: this.wallet.address,
      address: this.contractAddress,
      args: [data],
      maxFeePerGas: previousAttempt.maxFeePerGas,
      maxPriorityFeePerGas: previousAttempt.maxPriorityFeePerGas,
    }
    this.state = {
      tag: 'simulate' as const,
      opts
    }
  }

  async simulateContract(): Promise<void> {
    const state = this.state as SimulateContract
    await backOff(() => this.provider.simulateContract(state.opts), BACKOFF_OPTIONS)
    this.state = {
      tag: 'write',
      opts: state.opts
    }
  }

  async writeContract(): Promise<void> {
    const state = this.state as WriteContract
    const hash = await backOff(() => this.wallet.writeContract(state.opts), BACKOFF_OPTIONS)
    this.state = {
      tag: 'get_transaction',
      transaction: hash
    }
  }

  async getTransaction(): Promise<void> {
    const state = this.state as GetTransactionReceipt
    const tx = await backOff(() => this.provider.waitForTransactionReceipt(state.transaction), BACKOFF_OPTIONS)
    if (tx.successful) {
      this.state = {
        tag: 'get_block',
        transaction: tx,
      }
    } else {
      if (this.previousAttempt && this.previousAttempt.attemptNum < MAX_ATTEMPTS) {
        logger.warn(`Transaction failed, retrying (${this.previousAttempt.attemptNum} / ${MAX_ATTEMPTS})`)
      }
    }
  }

  async getBlock(): Promise<Transaction> {
    const state = this.state as GetBlock
    const block = await backOff(() => this.provider.getBlock(state.transaction.blockHash), BACKOFF_OPTIONS)
    if (!block.blockNumber) {
      throw new Error('Block did not have a block number')
    }

    logEvent.ethereum({
      type: 'txResponse',
      hash: state.transaction.blockHash,
      blockTimestamp: block.timestamp,
      blockNumber: block.blockNumber,
      blockHash: block.blockHash,
      from: state.transaction.from,
    })

    return new Transaction(this.chainId, state.transaction.blockHash, block.blockNumber, block.timestamp)

  }

  public async run(): Promise<Transaction> {
    for(;;) {
      if (this.state.tag == 'fee_history') {
        await this.getFeeHistory()
      } else if (this.state.tag == 'simulate') {
        await this.simulateContract()
      } else if (this.state.tag == 'write') {
        await this.writeContract()
      } else if (this.state.tag == 'get_transaction') {
        await this.getTransaction()
      } else if (this.state.tag == 'get_block') {
        return await this.getBlock()
      }
    }
  }
}
