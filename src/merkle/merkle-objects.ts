import CID from "cids";

import { Doctype } from '@ceramicnetwork/common';
import {
  CompareFunction,
  MergeFunction, MetadataFunction,
  Node,
  TreeMetadata,
} from './merkle';

import { logger } from '../logger';
import { IpfsService } from '../services/ipfs-service';

import bloom from 'bloomfilter.js';

const BLOOM_FILTER_TYPE = "jsnpm_bloomfilter.js";

export class Candidate {
  public readonly cid: CID;
  public readonly document: Doctype;
  public readonly reqId: number;

  constructor(cid: CID, reqId?: number, document?: Doctype) {
    this.cid = cid;
    this.reqId = reqId;
    this.document = document
  }

  get docId(): string {
    return this.document.id.baseID.toString()
  }

}

/**
 * Implements IPFS merge CIDs
 */
export class IpfsMerge implements MergeFunction<Candidate, TreeMetadata> {
  private ipfsService: IpfsService;

  constructor(ipfsService: IpfsService) {
    this.ipfsService = ipfsService;
  }

  async merge(left: Node<Candidate>, right: Node<Candidate>, metadata: TreeMetadata | null): Promise<Node<Candidate>> {
    const merged = [left.data.cid, right.data.cid];
    if (metadata) {
      const metadataCid = await this.ipfsService.storeRecord(metadata);
      merged.push(metadataCid)
    }

    const mergedCid = await this.ipfsService.storeRecord(merged);
    logger.debug('Merkle node ' + mergedCid + ' created.');
    return new Node<Candidate>(new Candidate(mergedCid), left, right);
  }
}

/**
 * Implements IPFS merge CIDs
 */
export class IpfsLeafCompare implements CompareFunction<Candidate> {
  compare(left: Node<Candidate>, right: Node<Candidate>): number {
    return left.data.docId.localeCompare(right.data.docId);
  }
}

/**
 * Implements IPFS merge CIDs
 */
export class BloomMetadata implements MetadataFunction<Candidate, TreeMetadata> {
  generateMetadata(leaves: Array<Node<Candidate>>): TreeMetadata {
    const bloomFilterEntries = new Set<string>()
    for (const node of leaves) {
      const doc = node.data.document
      bloomFilterEntries.add(`docid-${doc.id.baseID.toString()}`)
      bloomFilterEntries.add(`schema-${doc.metadata.schema?.toString()}`)
      bloomFilterEntries.add(`family-${doc.metadata.family}`)
      if (doc.metadata.tags) {
        for (const tag of doc.metadata.tags) {
          bloomFilterEntries.add(`tag-${tag}`)
        }
      }
      for (const controller of doc.metadata.controllers) {
        bloomFilterEntries.add(`controller-${controller.toString()}`)
      }
    }
    const bloomFilter = new bloom(bloomFilterEntries.size)
    for (const entry of bloomFilterEntries) {
      bloomFilter.add(entry)
    }
    return { numEntries: leaves.length,
             bloomFilter: {type: BLOOM_FILTER_TYPE, data: bloomFilter.serialize()} }
  }
}