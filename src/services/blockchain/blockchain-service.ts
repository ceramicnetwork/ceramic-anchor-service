import type { CID } from 'multiformats/cid'
import Transaction from '../../models/transaction'

export default interface BlockchainService {
  /**
   * Connects to specific blockchain
   */
  connect(): Promise<void>

  /**
   * Sends transaction with root CID as data
   */
  sendTransaction(rootCid: CID): Promise<Transaction>

  /**
   * A string representing the CAIP-2 ID of the configured blockchain.
   */
  chainId: string
}
