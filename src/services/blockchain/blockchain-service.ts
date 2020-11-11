import CID from 'cids';
import Transaction from '../../models/transaction';
import Contextual from '../../contextual';

export interface BlockchainService extends Contextual {
  /**
   * Connects to specific blockchain
   */
  connect(): Promise<void>;

  /**
   * Sends transaction with root CID as data
   */
  sendTransaction(rootCid: CID): Promise<Transaction>;

  /**
   * Returns a string representing the CAIP-2 ID of the configured blockchain.
   */
  getChainId(): Promise<string>;
}
