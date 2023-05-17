import 'reflect-metadata'
import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { CID } from 'multiformats/cid'
import { config, Config } from 'node-config-ts'
import { logger } from '../../../logger/index.js'
import { BlockchainService } from '../blockchain-service.js'
import { EthereumBlockchainService, MAX_RETRIES } from '../ethereum/ethereum-blockchain-service.js'
import { readFile } from 'node:fs/promises'
import cloneDeep from 'lodash.clonedeep'
import { createInjector } from 'typed-inject'
import type { GanacheServer } from '../../../__tests__/make-ganache.util.js'
import { makeGanache } from '../../../__tests__/make-ganache.util.js'
import {
  http,
  Address,
  Chain,
  createPublicClient,
  createWalletClient,
  PublicClient,
  WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

class Scaffold {
  readonly provider: PublicClient
  readonly wallet: WalletClient
  readonly contractAddress: Address

  constructor(provider: PublicClient, wallet: WalletClient, contractAddress: Address) {
    this.provider = provider
    this.wallet = wallet
    this.contractAddress = contractAddress
  }
}

export const ganache = {
  id: 1_337,
  name: 'Foundry',
  network: 'foundry',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: ['http://127.0.0.1:8545'],
      webSocket: ['ws://127.0.0.1:8545'],
    },
    public: {
      http: ['http://127.0.0.1:8545'],
      webSocket: ['ws://127.0.0.1:8545'],
    },
  },
} as const satisfies Chain

const scaffolding = async (url: string): Promise<Scaffold> => {
  const account = privateKeyToAccount(config.blockchain.connectors.ethereum.account.privateKey)
  const transport = http(url)
  const provider = createPublicClient({
    chain: ganache,
    transport,
  })
  const wallet = createWalletClient({
    transport,
    account,
    chain: ganache,
  })

  const artifactFilename = new URL(
    '../../../../contracts/out/CeramicAnchorServiceV2.sol/CeramicAnchorServiceV2.json',
    import.meta.url
  )
  const contractData = await readFile(artifactFilename, 'utf-8').then(JSON.parse)

  const contractHash = await wallet.deployContract({
    bytecode: contractData.bytecode.object,
    account,
  })
  const tx = await provider.getTransaction({ hash: contractHash} )
  return new Scaffold(provider, wallet, tx.to)
}

describe('ETH service connected to ganache', () => {
  jest.setTimeout(25000)
  let ganacheServer: GanacheServer
  let ethBc: BlockchainService
  let testConfig: Config
  let scaffold: Scaffold

  beforeAll(async () => {
    ganacheServer = await makeGanache()
    scaffold = await scaffolding(ganacheServer.url.toString())

    testConfig = cloneDeep(config)
    testConfig.blockchain.connectors.ethereum.rpc.url = ganacheServer.url.toString()
    testConfig.blockchain.connectors.ethereum.contractAddress = scaffold.contractAddress.address
    testConfig.useSmartContractAnchors = false

    const injector = createInjector()
      .provideValue('config', testConfig)
      .provideFactory('blockchainService', EthereumBlockchainService.make)
    ethBc = await injector.resolve('blockchainService')
    await ethBc.connect()
  })

  afterAll(async () => {
    logger.imp(`Closing local Ethereum blockchain instance...`)
    await ganacheServer.close()
  })

  test('should anchor to contract', async () => {
    const block = await scaffold.provider.getBlock()
    const startTimestamp = block.timestamp
    const startBlockNumber = block.number

    const filter = await scaffold.provider.createEventFilter({
      address: scaffold.contractAddress,
    })

    const cid = CID.parse('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
    const ethBc = await EthereumBlockchainService.make(testConfig)
    await ethBc.connect()
    const tx = await ethBc.sendTransaction(cid)
    expect(tx).toBeDefined()

    const contractEvents = await scaffold.provider.getFilterLogs({ filter })

    expect(contractEvents.length).toEqual(1)
    const didAnchorEvent = contractEvents[0]
    expect(didAnchorEvent.name).toEqual('DidAnchor')
    expect(didAnchorEvent.args['_root']).toEqual(
      '0x5d7fcd1a0999befdb062e6762c1f0f902f729b98304a2ef539412f53360d3d6a'
    )

    // checking the values against the snapshot is too brittle since ganache is time based so we test manually
    expect(tx.blockTimestamp).toBeGreaterThan(startTimestamp)
    expect(tx.blockNumber).toBeGreaterThan(startBlockNumber)
  })
})
