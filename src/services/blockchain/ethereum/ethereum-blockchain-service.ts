import CID from "cids";

import * as providers from "@ethersproject/providers";
import { ErrorCode } from "@ethersproject/logger";

import { BigNumber, ethers } from "ethers";
import { config } from "node-config-ts";
import { Logger as logger } from "@overnightjs/logger/lib/Logger";

import Context from "../../../context";
import Transaction from "../../../models/transaction";
import { BlockchainService } from "../blockchain-service";
import { TransactionRequest } from "@ethersproject/abstract-provider";

/**
 * Ethereum blockchain service
 */
export default class EthereumBlockchainService implements BlockchainService {
  private ctx: Context;
  private provider: providers.BaseProvider;

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
    logger.Imp("Connecting to " + config.blockchain.connectors.ethereum.network + " blockchain...");
    const { network } = config.blockchain.connectors.ethereum;

    if (network === "ganache") {
      const { host, port } = config.blockchain.connectors.ethereum.rpc;
      const url = `${host}:${port}`;
      this.provider = new ethers.providers.JsonRpcProvider(url);
    } else {
      this.provider = ethers.getDefaultProvider(network);
    }

    await this.provider.getNetwork();
    logger.Imp("Connected to " + config.blockchain.connectors.ethereum.network + " blockchain.");
  }

  /**
   * Sends transaction with root CID as data
   */
  public async sendTransaction(rootCid: CID): Promise<Transaction> {
    const wallet = new ethers.Wallet(config.blockchain.connectors.ethereum.account.privateKey, this.provider);
    const walletBalance = await this.provider.getBalance(wallet.address);
    logger.Imp(`Current wallet balance is ` + walletBalance);

    const rootStrHex = rootCid.toString("base16");
    const hexEncoded = "0x" + (rootStrHex.length % 2 == 0 ? rootStrHex : "0" + rootStrHex);
    logger.Imp(`Hex encoded root CID ${hexEncoded}`);

    const { network } = config.blockchain.connectors.ethereum;
    logger.Imp(`Sending transaction to Ethereum ${network} network...`);

    const baseNonce = await this.provider.getTransactionCount(wallet.getAddress());

    const txData: TransactionRequest = {
      to: wallet.address,
      data: hexEncoded,
      nonce: baseNonce + 1,
    };

    let { overrideGasConfig } = config.blockchain.connectors.ethereum;
    if (typeof overrideGasConfig === "string") {
      overrideGasConfig = overrideGasConfig as string === 'true'
    }
    if (overrideGasConfig) {
      txData.gasPrice = BigNumber.from(config.blockchain.connectors.ethereum.gasPrice);
      logger.Info('Overriding Gas price: ' + txData.gasPrice.toString());

      txData.gasLimit = BigNumber.from(config.blockchain.connectors.ethereum.gasLimit);
      logger.Info('Overriding Gas limit: ' + txData.gasLimit.toString());
    }

    let retryTimes = 3;
    while (retryTimes > 0) {
      try {
        if (!overrideGasConfig) {
          txData.gasPrice = await this.provider.getGasPrice();
          logger.Info('Estimated Gas price: ' + txData.gasPrice.toString());

          txData.gasLimit = await this.provider.estimateGas(txData);
          logger.Info('Estimated Gas limit: ' + txData.gasLimit.toString());
        }

        logger.Imp("Transaction data:" + JSON.stringify(txData));

        const signedTransaction = await wallet.signTransaction(txData);
        const txResponse: providers.TransactionResponse = await this.provider.sendTransaction(signedTransaction);

        const caip2ChainId = "eip155:" + txResponse.chainId;
        const txReceipt: providers.TransactionReceipt = await this.provider.waitForTransaction(txResponse.hash);
        const block: providers.Block = await this.provider.getBlock(txReceipt.blockHash);

        logger.Imp(`Transaction successfully written to Ethereum ${network} network. Transaction hash ${txReceipt.transactionHash}`);
        return new Transaction(caip2ChainId, txReceipt.transactionHash, txReceipt.blockNumber, block.timestamp);
      } catch (err) {
        logger.Err(err, true);

        const { code } = err;
        if (code) {
          if (code === ErrorCode.INSUFFICIENT_FUNDS) {
            const txCost = (txData.gasLimit as BigNumber).mul(txData.gasPrice);
            if (txCost.gt(walletBalance)) {
              const errMsg = "Transaction cost is greater than our current balance. [txCost: " + txCost.toHexString() + ", balance: " + walletBalance.toHexString() + "]";
              logger.Err(errMsg);
              throw new Error(errMsg);
            }
          }
        }

        retryTimes--;
        if (retryTimes === 0) {
          throw new Error("Failed to send transaction");
        } else {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }
  }
}
