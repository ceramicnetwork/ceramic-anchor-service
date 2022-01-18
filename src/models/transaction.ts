export class Transaction {
  chain: string
  txHash: string
  blockNumber: number
  blockTimestamp: number

  constructor(chain: string, txHash: string, blockNumber: number, blockTimestamp: number) {
    this.chain = chain
    this.txHash = txHash
    this.blockNumber = blockNumber
    this.blockTimestamp = blockTimestamp
  }
}
