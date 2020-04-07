import Context from '../context';
import RequestService from './request-service';

import Contextual from '../contextual';

import CID from 'cids';
import { Ipfs } from 'ipfs';
import ipfsClient from 'ipfs-http-client';
import { Logger as logger } from '@overnightjs/logger';
import { RequestStatus } from '../models/request-status';

import { config } from 'node-config-ts';
import { MergeFunction, Node, PathDirection } from '../merkle/merkle';
import { MerkleTree } from '../merkle/merkle-tree';
import { Anchor } from '../models/anchor';
import { getManager } from 'typeorm';
import { Request } from '../models/request';
import BlockchainService from './blockchain-service';
import Transaction from '../models/transaction';
import Utils from "../utils";

/**
 * Anchors CIDs to blockchain
 */
export default class AnchorService implements Contextual {
  private readonly ipfs: Ipfs;
  private readonly ipfsMerge: IpfsMerge;

  private requestSrv: RequestService;
  private blockchainSrv: BlockchainService;

  constructor() {
    this.ipfs = ipfsClient(config.ipfsConfig.host);
    this.ipfsMerge = new IpfsMerge(this.ipfs);
  }

  setContext(context: Context): void {
    this.requestSrv = context.lookup('RequestService');
    this.blockchainSrv = context.lookup('BlockchainService');
  }

  /**
   * Gets anchor metadata
   * @param request - Request id
   */
  public async findByRequest(request: Request): Promise<Anchor> {
    return await getManager()
      .getRepository(Anchor)
      .createQueryBuilder('anchor')
      .where('anchor.request_id = :requestId', { requestId: request.id })
      .getOne();
  }

  /**
   * Creates anchors for client requests
   */
  public async anchorRequests(): Promise<void> {
    const requests = await this.requestSrv.findByStatus(RequestStatus.PENDING);

    if (requests.length < 2) {
      logger.Info('Not enough CID requests to create Merkle tree. Number of requests: ' + requests.length);
      return;
    }

    await this.requestSrv.updateStatus(RequestStatus.PENDING, RequestStatus.PROCESSING);

    const cids = requests.map((r) => new CID(r.cid));
    const merkleTree: MerkleTree<CID> = await this._createMerkleTree(cids);

    const tx: Transaction = await this.blockchainSrv.sendTransaction(merkleTree.getRoot().data);

    const anchorRepository = getManager().getRepository(Anchor);

    for (let index = 0; index < cids.length; index++) {
      const request: Request = requests[index];

      const anchor: Anchor = new Anchor();
      anchor.request = request;
      anchor.proof = merkleTree.getRoot().data.toBaseEncodedString();
      anchor.blockNumber = tx.blockNumber;
      anchor.blockTimestamp = tx.blockTimestamp;
      anchor.chain = tx.chain;
      anchor.txHash = tx.txHash;
      anchor.txHashCid = Utils.convertEthHashToCid('eth-tx', tx.txHash.slice(2)).toString();

      const path = await merkleTree.getDirectPathFromRoot(index);
      anchor.path = path.map((p) => PathDirection[p].toString()).toString();

      await anchorRepository.save(anchor);

      request.status = RequestStatus.COMPLETED;
      await this.requestSrv.update(request);
    }
  }

  /**
   * Creates Merkle tree and adds merged docs to IPFS
   * @param cids - CID array
   * @private
   */
  private async _createMerkleTree(cids: CID[]): Promise<MerkleTree<CID>> {
    const merkleTree: MerkleTree<CID> = new MerkleTree<CID>(this.ipfsMerge);
    await merkleTree.build(cids);
    return merkleTree;
  }
}

/**
 * Implements IPFS merge CIDs
 */
// tslint:disable-next-line:max-classes-per-file
class IpfsMerge implements MergeFunction<CID> {
  private ipfs: Ipfs;

  constructor(ipfs: Ipfs) {
    this.ipfs = ipfs;
  }

  async merge(left: Node<CID>, right: Node<CID>): Promise<Node<CID>> {
    const merged = {
      L: left.data,
      R: right.data,
    };

    const mergedCid = await this.ipfs.dag.put(merged);
    return new Node<CID>(mergedCid, left, right);
  }
}
