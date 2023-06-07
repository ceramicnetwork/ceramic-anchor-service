import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import {Block, ContractParameters, EthereumClient, FeeHistory, TransactionReceipt} from "../ethereum/ethereum-client.js"
import {Address} from "viem"
import {TransactionHash} from "../ethereum/ethereum-wallet.js"
import {TransactionStateMachine} from "../ethereum/transaction-state-machine.js";
import {CID} from "multiformats/cid";

const FROM = '0x1234'
const WALLET = '0x1234abcd'
const CONTRACT = '0xfeed'

class MockEthereumClient implements EthereumClient {
  async getChainId(): Promise<number> {
    return 1337
  }

  async simulateContract(opts: ContractParameters): Promise<void> {
    return
  }

  async waitForTransactionReceipt(hash: Address): Promise<TransactionReceipt> {
    return {
      blockHash: hash,
      from: FROM,
      successful: true,
    }
  }

  async getBlock(hash: Address): Promise<Block> {
    return {
      blockNumber: 1n,
      blockHash: hash,
      timestamp: 0n,
    }
  }

  async getFeeHistory(): Promise<FeeHistory> {
    return {
      baseFeePerGas: 100n,
    }
  }
}

class MockEthereumWallet {
  readonly address = WALLET
  async writeContract(req: ContractParameters): Promise<TransactionHash> {
    return '0xdeadbeef'
  }
}

describe('TransactionStateMachine with mocks', () => {
  test('no errors encountered', async () => {
    const provider = new MockEthereumClient()
    const wallet = new MockEthereumWallet()
    const cid = CID.parse('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
    const tsm = new TransactionStateMachine('test', provider, wallet, CONTRACT, cid)
    const res = await tsm.run()
    expect(res).toMatchSnapshot()
  })

  test('simulate fails due to timeout', async () => {
    const provider = new MockEthereumClient()
    const wallet = new MockEthereumWallet()
    const simulateSpy = jest.spyOn(provider, 'simulateContract')
      .mockImplementationOnce(() => {
        throw new Error('Timeout')
      })
    const writeSpy = jest.spyOn(wallet, 'writeContract')
    const cid = CID.parse('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
    const tsm = new TransactionStateMachine('test', provider, wallet, CONTRACT, cid)
    const res = await tsm.run()
    expect(res).toMatchSnapshot()
    expect(simulateSpy.mock.calls.length).toEqual(2)
    expect(writeSpy.mock.calls.length).toEqual(1)
  })

  test('write fails due to timeout', async () => {
    const provider = new MockEthereumClient()
    const wallet = new MockEthereumWallet()
    const writeSpy = jest.spyOn(wallet, 'writeContract')
      .mockImplementationOnce(() => {
        throw new Error('Timeout')
      })
    const transactionSpy = jest.spyOn(provider, 'waitForTransactionReceipt')
    const cid = CID.parse('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
    const tsm = new TransactionStateMachine('test', provider, wallet, CONTRACT, cid)
    const res = await tsm.run()
    expect(res).toMatchSnapshot()
    expect(writeSpy.mock.calls.length).toEqual(2)
    expect(transactionSpy.mock.calls.length).toEqual(1)
  })

  test('transaction receipt fails due to timeout', async () => {
    const provider = new MockEthereumClient()
    const wallet = new MockEthereumWallet()
    const writeSpy = jest.spyOn(wallet, 'writeContract')
    const transactionSpy = jest.spyOn(provider, 'waitForTransactionReceipt')
      .mockImplementationOnce(() => {
        throw new Error('Timeout')
      })
    const blockSpy = jest.spyOn(provider, 'getBlock')
    const cid = CID.parse('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
    const tsm = new TransactionStateMachine('test', provider, wallet, CONTRACT, cid)
    const res = await tsm.run()
    expect(res).toMatchSnapshot()
    expect(writeSpy.mock.calls.length).toEqual(1)
    expect(transactionSpy.mock.calls.length).toEqual(2)
    expect(blockSpy.mock.calls.length).toEqual(1)
  })

  test('get block fails due to timeout', async () => {
    const provider = new MockEthereumClient()
    const wallet = new MockEthereumWallet()
    const transactionSpy = jest.spyOn(provider, 'waitForTransactionReceipt')
    const blockSpy = jest.spyOn(provider, 'getBlock')
      .mockImplementationOnce(() => {
        throw new Error('Timeout')
      })
    const cid = CID.parse('bafyreic5p7grucmzx363ayxgoywb6d4qf5zjxgbqjixpkokbf5jtmdj5ni')
    const tsm = new TransactionStateMachine('test', provider, wallet, CONTRACT, cid)
    const res = await tsm.run()
    expect(res).toMatchSnapshot()
    expect(transactionSpy.mock.calls.length).toEqual(1)
    expect(blockSpy.mock.calls.length).toEqual(2)
  })

})
