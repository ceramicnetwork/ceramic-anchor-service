export class Transaction {
  chain: string
  txHash: string
  blockNumber: number
  blockTimestamp: Date

  constructor(chain: string, txHash: string, blockNumber: number, blockDate: Date) {
    this.chain = chain
    this.txHash = txHash
    this.blockNumber = blockNumber
    this.blockTimestamp = blockDate
  }
}
