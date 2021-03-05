import CID from "cids";

import * as providers from "@ethersproject/providers";
import { ErrorCode } from "@ethersproject/logger";

import { BigNumber, ethers } from "ethers";
import { config } from "node-config-ts";

import { logger, logEvent, logMetric } from "../../../logger";
import Transaction from "../../../models/transaction";
import BlockchainService from "../blockchain-service";
import { TransactionRequest } from "@ethersproject/abstract-provider";

const BASE_CHAIN_ID = "eip155";
const TX_FAILURE = 0;
const TX_SUCCESS = 1;
const MAX_RETRIES = 3;

const POLLING_INTERVAL = 15 * 1000 // every 15 seconds

/**
 * Ethereum blockchain service
 */
export default class EthereumBlockchainService implements BlockchainService {
  private _chainId: string;
  private provider: providers.BaseProvider;

  /**
   * Connects to blockchain
   */
  public async connect(): Promise<void> {
    logger.imp("Connecting to " + config.blockchain.connectors.ethereum.network + " blockchain...");
    const { network } = config.blockchain.connectors.ethereum;
    const { host, port, url } = config.blockchain.connectors.ethereum.rpc;

    if (url && url != "") {
      this.provider = new ethers.providers.JsonRpcProvider(url);
    } else if (host && host != "" && port && port != "") {
      this.provider = new ethers.providers.JsonRpcProvider(`${host}:${port}`);
    } else {
      this.provider = ethers.getDefaultProvider(network);
    }

    this.provider.pollingInterval = POLLING_INTERVAL

    await this.provider.getNetwork();
    await this._loadChainId();
    logger.imp('Connected to ' + config.blockchain.connectors.ethereum.network + ' blockchain with chain ID ' + this.chainId);
  }

  /**
   * Returns a string representing the CAIP-2 ID of the configured blockchain by querying the
   * connected blockchain to ask for it.
   */
  private async _loadChainId(): Promise<void> {
    const idnum = (await this.provider.getNetwork()).chainId;
    this._chainId = BASE_CHAIN_ID + ':' + idnum
  }

  /**
   * Sets the gas price for the transaction request
   * @param txData - transaction request data
   * @param attempt - what number attempt this is at submitting the transaction.  We increase
   *   the gas price we set by a 10% multiple with each subsequent attempt
   * @private
   */
  private async _setGasPrice(txData: TransactionRequest, attempt: number): Promise<void> {
    const { overrideGasConfig } = config.blockchain.connectors.ethereum;
    if (config.blockchain.connectors.ethereum.overrideGasConfig) {
      txData.gasPrice = BigNumber.from(config.blockchain.connectors.ethereum.gasPrice);
      logger.debug('Overriding Gas price: ' + txData.gasPrice.toString());

      txData.gasLimit = BigNumber.from(config.blockchain.connectors.ethereum.gasLimit);
      logger.debug('Overriding Gas limit: ' + txData.gasLimit.toString());
    } else {
      const gasPriceEstimate = await this.provider.getGasPrice();
      // Add 10% extra to gas price for each subsequent attempt
      txData.gasPrice = gasPriceEstimate.add(gasPriceEstimate.mul(attempt * .01));
      logger.debug('Estimated Gas price: ' + txData.gasPrice.toString());

      txData.gasLimit = await this.provider.estimateGas(txData);
      logger.debug('Estimated Gas limit: ' + txData.gasLimit.toString());
    }


  }

  /**
   * Returns the cached 'chainId' representing the CAIP-2 ID of the configured blockchain.
   * Invalid to call before calling connect()
   */
  public get chainId(): string {
    return this._chainId
  }

  /**
   * Sends transaction with root CID as data
   */
  public async sendTransaction(rootCid: CID): Promise<Transaction> {
    const wallet = new ethers.Wallet(config.blockchain.connectors.ethereum.account.privateKey, this.provider);
    const walletBalance = await this.provider.getBalance(wallet.address);
    logMetric.ethereum({
      type: 'walletBalance',
      balance: ethers.utils.formatUnits(walletBalance, 'gwei')
    });
    logger.imp(`Current wallet balance is ` + walletBalance);

    const rootStrHex = rootCid.toString("base16");
    const hexEncoded = "0x" + (rootStrHex.length % 2 == 0 ? rootStrHex : "0" + rootStrHex);
    logger.imp(`Hex encoded root CID ${hexEncoded}`);

    const { network } = config.blockchain.connectors.ethereum;

    logger.debug("Preparing ethereum transaction")
    const baseNonce = await this.provider.getTransactionCount(wallet.getAddress());

    const txData: TransactionRequest = {
      to: wallet.address,
      data: hexEncoded,
      nonce: baseNonce,
    };
    const transactionTimeoutSecs = config.blockchain.connectors.ethereum.transactionTimeoutSecs

    let attemptNum = 0;
    while (attemptNum < MAX_RETRIES) {
      try {
        await this._setGasPrice(txData, attemptNum);
        logger.imp("Transaction data:" + JSON.stringify(txData));

        logEvent.ethereum({
          type: 'txRequest',
          ...txData
        });
        logger.imp(`Sending transaction to Ethereum ${network} network...`);
        const txResponse: providers.TransactionResponse = await wallet.sendTransaction(txData);
        logEvent.ethereum({
          type: 'txResponse',
          hash: txResponse.hash,
          blockNumber: txResponse.blockNumber,
          blockHash: txResponse.blockHash,
          timestamp: txResponse.timestamp,
          confirmations: txResponse.confirmations,
          from: txResponse.from,
          raw: txResponse.raw,
        });
        const caip2ChainId = "eip155:" + txResponse.chainId;
        if (caip2ChainId != this.chainId) {
          // TODO: This should be process-fatal
          throw new Error("Chain ID of connected blockchain changed from " + this.chainId + " to " + caip2ChainId)
        }

        const txReceipt: providers.TransactionReceipt = await this.provider.waitForTransaction(
          txResponse.hash, 1, transactionTimeoutSecs * 1000);
        logEvent.ethereum({
          type: 'txReceipt',
          ...txReceipt
        });
        const block: providers.Block = await this.provider.getBlock(txReceipt.blockHash);

        const status = txReceipt.byzantium ? txReceipt.status : -1;
        let statusMessage = (status == TX_SUCCESS) ? 'success' : 'failure';
        if (!txReceipt.byzantium) {
          statusMessage = 'unknown';
        }
        logger.imp(`Transaction completed on Ethereum ${network} network. Transaction hash: ${txReceipt.transactionHash}. Status: ${statusMessage}.`);
        if (status == TX_FAILURE) {
          throw new Error("Transaction completed with a failure status");
        }

        return new Transaction(caip2ChainId, txReceipt.transactionHash, txReceipt.blockNumber, block.timestamp);
      } catch (err) {
        logger.err(err);

        const { code } = err;
        if (code) {
          if (code === ErrorCode.INSUFFICIENT_FUNDS) {
            const txCost = (txData.gasLimit as BigNumber).mul(txData.gasPrice);
            if (txCost.gt(walletBalance)) {

              logEvent.ethereum({
                type: 'insufficientFunds',
                txCost: txCost,
                balance: ethers.utils.formatUnits(walletBalance, 'gwei')
              });

              const errMsg = "Transaction cost is greater than our current balance. [txCost: " + txCost.toHexString() + ", balance: " + walletBalance.toHexString() + "]";
              logger.err(errMsg);
              throw new Error(errMsg);
            }
          } else if (code === ErrorCode.TIMEOUT) {
            logEvent.ethereum({
              type: 'transactionTimeout',
              transactionTimeoutSecs,
            });
            logger.err(`Transaction timed out after ${transactionTimeoutSecs} seconds without being mined`);
            // Fall through and retry if we have retries remaining
          }
        }

        attemptNum++;
        if (attemptNum >= MAX_RETRIES) {
          throw new Error("Failed to send transaction");
        } else {
          logger.warn(`Failed to send transaction; ${MAX_RETRIES - attemptNum} retries remain`)
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }

    const finalWalletBalance = await this.provider.getBalance(wallet.address);
    logMetric.ethereum({
      type: 'walletBalance',
      balance: ethers.utils.formatUnits(finalWalletBalance, 'gwei')
    });
  }
}
