export default class Transaction {
  chain: number;
  txHash: string;
  blockNumber: number;
  blockTimestamp: number;

  constructor(chain: number, txHash: string, blockNumber: number, blockTimestamp: number) {
    this.chain = chain;
    this.txHash = txHash;
    this.blockNumber = blockNumber;
    this.blockTimestamp = blockTimestamp;
  }
}
