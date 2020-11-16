import CID from 'cids';

import * as providers from "@ethersproject/providers"

import { BigNumber, ethers } from "ethers";
import { config } from 'node-config-ts';
import { Logger as logger } from '@overnightjs/logger/lib/Logger';

import Context from '../../../context';
import Transaction from '../../../models/transaction';
import { BlockchainService } from '../blockchain-service';

const BASE_CHAIN_ID = "eip155"

/**
 * Ethereum blockchain service
 */
export default class EthereumBlockchainService implements BlockchainService {
  private ctx: Context;
  private provider: providers.BaseProvider;
  private _chainId: string;

  /**
   * Set application context
   * @param context
   */
  setContext(context: Context): void {
    this.ctx = context;
  }

  /**
   * Connects to blockchain
   */
  public async connect(): Promise<void> {
    logger.Imp('Connecting to ' + config.blockchain.connectors.ethereum.network + ' blockchain...');
    const { network } = config.blockchain.connectors.ethereum;

    if (network === 'ganache') {
      const { host, port } = config.blockchain.connectors.ethereum.rpc;
      const url = `${host}:${port}`;
      this.provider = new ethers.providers.JsonRpcProvider(url);
    } else {
      this.provider = ethers.getDefaultProvider(network);
    }

    await this.provider.getNetwork();
    await this._loadChainId()
    logger.Imp('Connected to ' + config.blockchain.connectors.ethereum.network + ' blockchain with chain ID ' + this.chainId);
  }

  /**
   * Returns a string representing the CAIP-2 ID of the configured blockchain by querying the
   * connected blockchain to ask for it.
   */
  private async _loadChainId(): Promise<void> {
    const wallet = new ethers.Wallet(config.blockchain.connectors.ethereum.account.privateKey, this.provider);
    const idnum = await wallet.getChainId()
    this._chainId = BASE_CHAIN_ID + ':' + idnum
  }

  /**
   * Returns the cached 'chainId' representing the CAIP-2 ID of the configured blockchain.
   */
  public get chainId() {
    return this._chainId
  }

  /**
   * Sends transaction with root CID as data
   */
  public async sendTransaction(rootCid: CID): Promise<Transaction> {
    const wallet = new ethers.Wallet(config.blockchain.connectors.ethereum.account.privateKey, this.provider);

    const rootStrHex = rootCid.toString('base16');
    const hexEncoded = '0x' + (rootStrHex.length % 2 == 0 ? rootStrHex : '0' + rootStrHex);
    logger.Imp(`Hex encoded root CID ${hexEncoded}`);

    const { network } = config.blockchain.connectors.ethereum;
    logger.Imp(`Sending transaction to Ethereum ${network} network...`);

    const txData = {
      to: wallet.address,
      data: hexEncoded,
    };

    if (config.blockchain.connectors.ethereum.overrideGasConfig === true) {
      Object.assign(txData, {
        gasLimit: +config.blockchain.connectors.ethereum.gasLimit,
        gasPrice: BigNumber.from(config.blockchain.connectors.ethereum.gasPrice),
      });
    }

    const txResponse: providers.TransactionResponse = await wallet.sendTransaction(txData);

    const txReceipt: providers.TransactionReceipt = await this.provider.waitForTransaction(txResponse.hash);
    const block: providers.Block = await this.provider.getBlock(txReceipt.blockHash);

    const caip2ChainId = BASE_CHAIN_ID + ':' + txResponse.chainId;
    if (caip2ChainId != this.chainId) {
      // TODO: this should be process-fatal
      throw new Error("Chain ID of connected blockchain changed from " + this.chainId + " to " + caip2ChainId)
    }

    logger.Imp(`Transaction successfully written to Ethereum ${network} network. Transaction hash ${txReceipt.transactionHash}`);
    return new Transaction(caip2ChainId, txReceipt.transactionHash, txReceipt.blockNumber, block.timestamp);
  }
}
