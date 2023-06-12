import type { BlockchainService } from '../blockchain/blockchain-service.js'
import type { Transaction } from '../../models/transaction.js'

export class FakeEthereumBlockchainService implements BlockchainService {
  chainId = 'impossible'

  async connect(): Promise<void> {
    throw new Error(`Failed to connect`)
  }

  async sendTransaction(): Promise<Transaction> {
    throw new Error('Failed to send transaction!')
  }
}
