import {
  Address,
  ParseAbi, PublicClient,
} from "viem";

export interface ContractParameters {
  abi: ParseAbi<any>,
  functionName: string,
  account: Address,
  address: Address,
  args: any[],
  maxFeePerGas: bigint,
  maxPriorityFeePerGas: bigint,
}

export type BlockHash = Address

export type TransactionReceipt = {
  blockHash: BlockHash
  from: Address
  successful: boolean
}

export type Block = {
  blockHash: BlockHash | null
  blockNumber: bigint | null
  timestamp: bigint
}

export type FeeHistory = {
  baseFeePerGas: bigint
}

export interface EthereumClient {
  getChainId(): Promise<number>
  simulateContract(opts: ContractParameters): Promise<void>
  waitForTransactionReceipt(hash: Address): Promise<TransactionReceipt>
  getBlock(hash: Address): Promise<Block>
  getFeeHistory(): Promise<FeeHistory>
}

export class ViemEthereumClient implements EthereumClient {
  private readonly inner: PublicClient

  constructor(inner: PublicClient) {
    this.inner = inner
  }

  async getChainId(): Promise<number> {
    return await this.inner.getChainId()
  }

  async simulateContract(opts: ContractParameters): Promise<void> {
    await this.inner.simulateContract(opts)
  }

  async waitForTransactionReceipt(hash: Address): Promise<TransactionReceipt> {
    const res = await this.inner.waitForTransactionReceipt(({ hash: hash}))
    return {
      blockHash: res.blockHash,
      from: res.from,
      successful: res.status == 'success'
    }
  }

  async getBlock(hash: Address): Promise<Block> {
    const res = await this.inner.getBlock({blockHash: hash})
    return {
      blockHash: res.hash,
      blockNumber: res.number,
      timestamp: res.timestamp
    }
  }

  async getFeeHistory(): Promise<FeeHistory> {
    const res = await this.inner.getFeeHistory({
      blockCount: 4,
      rewardPercentiles: [25, 75]
    })
    if (res.baseFeePerGas.length == 0 || !res.baseFeePerGas[0]) {
      throw new Error('Unable to get baseFeePerGas')
    }
    return {
      baseFeePerGas: res.baseFeePerGas[0]
    }
  }
}
