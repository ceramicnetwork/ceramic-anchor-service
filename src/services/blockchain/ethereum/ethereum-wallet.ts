import {Address, WalletClient} from "viem";
import {ContractParameters} from "./ethereum-client.js";

export type TransactionHash = Address

export interface EthereumWallet {
  readonly address: Address
  writeContract(req: ContractParameters): Promise<TransactionHash>;
}

export class ViemEthereumWallet implements EthereumWallet {
  private readonly inner: WalletClient
  readonly address: Address

  constructor(inner: WalletClient, address: Address) {
    this.inner = inner
    this.address = address
  }

  public static async create(inner: WalletClient): Promise<EthereumWallet> {
    const walletAddress = (await inner.getAddresses()).at(0)
    if(!walletAddress) {
      throw new Error('No wallet addresses found')
    }
    return new ViemEthereumWallet(inner, walletAddress)
  }

  async writeContract(req: ContractParameters): Promise<TransactionHash> {
    return await this.inner.writeContract({
      abi: req.abi,
      functionName: req.functionName,
      address: req.address,
      account: req.account,
      chain: this.inner.chain,
    })
  }
}
