import CID from 'cids';
import { BaseProvider, Block, TransactionReceipt, TransactionResponse } from 'ethers/providers';

import { ethers, utils } from 'ethers';
import { config } from 'node-config-ts';
import { Logger as logger } from '@overnightjs/logger/lib/Logger';

import Context from '../../../context';
import Transaction from '../../../models/transaction';
import { BlockchainService } from '../blockchain-service';

/**
 * Ethereum blockchain service
 */
export default class EthereumBlockchainService implements BlockchainService {
  private ctx: Context;
  private provider: BaseProvider;

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
    const txResponse: TransactionResponse = await wallet.sendTransaction({
      to: wallet.address,
      data: hexEncoded,
      gasLimit: config.blockchain.connectors.ethereum.gasLimit,
      gasPrice: utils.bigNumberify(config.blockchain.connectors.ethereum.gasPrice),
    });

    const txReceipt: TransactionReceipt = await this.provider.waitForTransaction(txResponse.hash);
    const block: Block = await this.provider.getBlock(txReceipt.blockHash);

    const caip2ChainId = 'eip155:' + txResponse.chainId;

    logger.Imp(`Transaction successfully written to Ethereum ${network} network. Transaction hash ${txReceipt.transactionHash}`);
    return new Transaction(caip2ChainId, txReceipt.transactionHash, txReceipt.blockNumber, block.timestamp);
  }
}
