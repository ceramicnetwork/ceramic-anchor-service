import type { DiagnosticsLogger } from '@ceramicnetwork/common'
import { CARFactory, CAR } from 'cartonne'
import * as DAG_JOSE from 'dag-jose'
import {
  IpfsLeafCompare,
  MerkleTreeFactory,
  IpfsMerge,
  type MerkleTree,
  type Node,
  type PathDirection,
  type CIDHolder,
  type TreeMetadata,
} from '@ceramicnetwork/anchor-utils'
import { BloomMetadata } from './bloom-metadata.js'
import type { Candidate } from '../services/candidate.js'
import type { CID } from 'multiformats/cid'

const carFactory = new CARFactory()
carFactory.codecs.add(DAG_JOSE)

export class CARIpfsService {
  readonly car: CAR
  constructor(car?: CAR) {
    this.car = car || carFactory.build()
  }

  async storeRecord(record: any): Promise<CID> {
    return this.car.put(record)
  }
}

export type MerkleCarFactoryResult = {
  tree: MerkleTree<CIDHolder, Candidate, TreeMetadata>
  car: CAR
}

export interface IMerkleTree<TData, TLeaf extends TData, TMetadata> {
  readonly root: Node<TData>
  readonly leafNodes: Array<Node<TLeaf>>
  readonly metadata: TMetadata | null
  getProof(elemIndex: number): Array<Node<TData>>
  getDirectPathFromRoot(elemIndex: number): PathDirection[]
  verifyProof(proof: Node<TData>[], element: TData): Promise<boolean>
}

export class MerkleCAR implements IMerkleTree<CIDHolder, Candidate, TreeMetadata> {
  readonly root: Node<CIDHolder>
  readonly leafNodes: Array<Node<Candidate>>
  readonly metadata: TreeMetadata | null

  constructor(readonly tree: MerkleTree<CIDHolder, Candidate, TreeMetadata>, readonly car: CAR) {
    this.root = tree.root
    this.leafNodes = tree.leafNodes
    this.metadata = tree.metadata
  }
  getProof(elemIndex: number): Array<Node<CIDHolder>> {
    return this.tree.getProof(elemIndex)
  }
  getDirectPathFromRoot(elemIndex: number): PathDirection[] {
    return this.tree.getDirectPathFromRoot(elemIndex)
  }
  verifyProof(proof: Node<CIDHolder>[], element: CIDHolder): Promise<boolean> {
    return this.tree.verifyProof(proof, element)
  }
}

export class MerkleCarFactory {
  private readonly ipfsCompare: IpfsLeafCompare
  private readonly bloomMetadata: BloomMetadata

  constructor(private readonly logger: DiagnosticsLogger, private readonly depthLimit: number) {
    this.ipfsCompare = new IpfsLeafCompare(this.logger)
    this.bloomMetadata = new BloomMetadata()
  }

  async build(candidates: Candidate[]): Promise<MerkleCAR> {
    const carService = new CARIpfsService()
    const carMerge = new IpfsMerge(carService, this.logger)
    const factory = new MerkleTreeFactory<CIDHolder, Candidate, TreeMetadata>(
      carMerge,
      this.ipfsCompare,
      this.bloomMetadata,
      this.depthLimit
    )
    const merkleTree = await factory.build(candidates)
    const car = carService.car
    car.roots.push(merkleTree.root.data.cid)
    return new MerkleCAR(merkleTree, car)
  }
}
