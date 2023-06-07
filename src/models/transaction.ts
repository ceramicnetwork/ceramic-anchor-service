export class Transaction {
  chain: string
  txHash: string
  blockNumber: bigint
  blockTimestamp: bigint

  constructor(chain: string, txHash: string, blockNumber: bigint, blockTimestamp: bigint) {
    this.chain = chain
    this.txHash = txHash
    this.blockNumber = blockNumber
    this.blockTimestamp = blockTimestamp
  }
}
