import type { CID } from 'multiformats/cid'
import { Config } from 'node-config-ts'

import { logger } from '../../../logger/index.js'
import { Transaction } from '../../../models/transaction.js'
import { BlockchainService } from '../blockchain-service.js'
import {
  Address,
  createPublicClient,
  createWalletClient,
  http,
} from 'viem'
import * as chains from 'viem/chains'
import {privateKeyToAccount} from "viem/accounts";
import {EthereumClient, ViemEthereumClient} from "./ethereum-client.js";
import {EthereumWallet, ViemEthereumWallet} from "./ethereum-wallet.js";
import {TransactionStateMachine} from "./transaction-state-machine.js";

const BASE_CHAIN_ID = 'eip155'
export const MAX_RETRIES = 3

const POLLING_INTERVAL = 15 * 1000 // every 15 seconds

/**
 * Represent chainId in CAIP format.
 * @param chainId - Numeric chain id.
 */
function caipChainId(chainId: number) {
  return `${BASE_CHAIN_ID}:${chainId}`
}

async function make(config: Config): Promise<EthereumBlockchainService> {
  const ethereum = config.blockchain.connectors.ethereum
  const { host, port, url } = ethereum.rpc

  const chain = chains.find(ch => ch.network == ethereum.network)
  let transport
  if (url) {
    logger.imp(`Connecting ethereum provider to url: ${url}`)
    transport = http(url)
  } else if (host && port) {
    logger.imp(`Connecting ethereum provider to host: ${host} and port ${port}`)
    transport = http(`http://${host}:${port}`)
  } else {
    logger.imp(`Connecting ethereum to default provider for network ${ethereum.network}`)
    transport = http()
  }
  const provider = new ViemEthereumClient(createPublicClient({
    chain,
    transport,
    pollingInterval: POLLING_INTERVAL,
  }))

  const wallet = await ViemEthereumWallet.create(createWalletClient({
    chain,
    transport,
    account: privateKeyToAccount(ethereum.account.privateKey)
  }))
  return new EthereumBlockchainService(config, provider, wallet)
}
make.inject = ['config'] as const

/**
 * Ethereum blockchain service
 */
export class EthereumBlockchainService implements BlockchainService {
  private _chainId: number | undefined
  private readonly network: string
  private readonly contractAddress: Address
  private readonly provider: EthereumClient
  private readonly wallet: EthereumWallet

  constructor(config: Config, provider: EthereumClient, wallet: EthereumWallet) {
    const ethereumConfig = config.blockchain.connectors.ethereum
    this.network = ethereumConfig.network
    this.contractAddress = ethereumConfig.contractAddress as Address
    this.provider = provider
    this.wallet = wallet
  }

  static make = make

  /**
   * Connects to blockchain
   */
  async connect(): Promise<void> {
    logger.imp(`Connecting to ${this.network} blockchain...`)
    await this._loadChainId()
    logger.imp(`Connected to ${this.network} blockchain with chain ID ${this.chainId}`)
  }

  /**
   * Returns a string representing the CAIP-2 ID of the configured blockchain by querying the
   * connected blockchain to ask for it.
   */
  private async _loadChainId(): Promise<void> {
    this._chainId = await this.provider.getChainId()
  }

  /**
   * Returns the cached 'chainId' representing the CAIP-2 ID of the configured blockchain.
   * Invalid to call before calling connect()
   */
  get chainId(): string {
    if (!this._chainId) throw new Error(`No chainId available`)
    return caipChainId(this._chainId)
  }

  /**
   * Sends transaction with root CID as data
   */
  async sendTransaction(rootCid: CID): Promise<Transaction> {
    const stateMachine = new TransactionStateMachine(
      this.chainId,
      this.provider,
      this.wallet,
      this.contractAddress,
      rootCid
    )
    return await stateMachine.run()
  }
}
