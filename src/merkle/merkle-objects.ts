import CID from "cids";

import { Stream } from '@ceramicnetwork/common';
import {
  CompareFunction,
  MergeFunction, MetadataFunction,
  Node,
  TreeMetadata,
} from './merkle';

import { logger } from '../logger';
import { IpfsService } from '../services/ipfs-service';

import { BloomFilter } from 'bloom-filters';

const BLOOM_FILTER_TYPE = "jsnpm_bloom-filters";
const BLOOM_FILTER_FALSE_POSITIVE_RATE = 0.0001

export class Candidate {
  public readonly cid: CID;
  public readonly stream: Stream;
  public readonly reqId: number;

  constructor(cid: CID, reqId?: number, stream?: Stream) {
    this.cid = cid;
    this.reqId = reqId;
    this.stream = stream
  }

  get streamId(): string {
    return this.stream.id.baseID.toString()
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
    return left.data.streamId.localeCompare(right.data.streamId);
  }
}

/**
 * Implements IPFS merge CIDs
 */
export class BloomMetadata implements MetadataFunction<Candidate, TreeMetadata> {
  generateMetadata(leaves: Array<Node<Candidate>>): TreeMetadata {
    const bloomFilterEntries = new Set<string>()
    for (const node of leaves) {
      const stream = node.data.stream
      bloomFilterEntries.add(`docid-${stream.id.baseID.toString()}`)
      if (stream.metadata.schema) {
        bloomFilterEntries.add(`schema-${stream.metadata.schema.toString()}`)
      }
      if (stream.metadata.family) {
        bloomFilterEntries.add(`family-${stream.metadata.family}`)
      }
      if (stream.metadata.tags) {
        for (const tag of stream.metadata.tags) {
          bloomFilterEntries.add(`tag-${tag}`)
        }
      }
      for (const controller of stream.metadata.controllers) {
        bloomFilterEntries.add(`controller-${controller.toString()}`)
      }
    }
    const bloomFilter = BloomFilter.from(bloomFilterEntries, BLOOM_FILTER_FALSE_POSITIVE_RATE)
    // @ts-ignore
    const serializedBloomFilter = bloomFilter.saveAsJSON()
    return { numEntries: leaves.length,
             bloomFilter: {type: BLOOM_FILTER_TYPE, data: serializedBloomFilter} }
  }
}