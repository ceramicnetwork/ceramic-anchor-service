import { CARFactory, type CAR } from 'cartonne'
import type { CID } from 'multiformats/cid'
import AWSSDK from 'aws-sdk'
import LevelUp from 'levelup'
import S3LevelDOWN from 's3leveldown'
import * as DAG_JOSE from 'dag-jose'
import { logger } from '../logger/index.js'
import type { Config } from 'node-config-ts'

/**
 * A service for storing and retrieving the CAR file containing the entire anchor merkle tree,
 * along with the associated anchor proof and anchor commits.
 */
export interface IMerkleCarService {
  storeCarFile(anchorProofCID: CID, car: CAR): Promise<void>
  retrieveCarFile(anchorProofCID: CID): Promise<CAR | null>
}

/**
 * Factory for IMerkleCarService.
 */
export function makeMerkleCarService(config: Config): IMerkleCarService | null {
  const mode = config.carStorage.mode
  switch (mode) {
    case 's3':
      return new S3MerkleCarService(config)
    case 'inmemory':
      return new InMemoryMerkleCarService()
    case 'disabled':
      return null
    default:
      throw new Error(`Unrecognized carStorage mode: ${mode}`)
  }
}
makeMerkleCarService.inject = ['config'] as const

export class InMemoryMerkleCarService implements IMerkleCarService {
  readonly cars: Map<string, CAR> = new Map()

  async storeCarFile(anchorProofCID: CID, car: CAR): Promise<void> {
    this.cars.set(anchorProofCID.toString(), car)
  }

  async retrieveCarFile(anchorProofCID: CID): Promise<CAR | null> {
    return this.cars.get(anchorProofCID.toString()) || null
  }
}

const S3_STORE_SUFFIX = '/cas/anchor/merkle-car/'
const carFactory = new CARFactory()
carFactory.codecs.add(DAG_JOSE)

export class S3MerkleCarService implements IMerkleCarService {
  readonly s3StorePath: string
  private _s3store?: LevelUp.LevelUp

  constructor(config: Config) {
    this.s3StorePath = config.carStorage.s3BucketName + S3_STORE_SUFFIX
  }

  /**
   * `new LevelUp` attempts to open a database, which leads to a request to AWS.
   * Let's make initialization lazy.
   */
  get s3store(): LevelUp.LevelUp {
    if (!this._s3store) {
      this._s3store = new LevelUp(new S3LevelDOWN(this.s3StorePath, new AWSSDK.S3()))
    }
    return this._s3store
  }

  /**
   * Stores the given CAR file to S3, keyed by the CID of the anchor proof for the batch.
   * Throws on error.
   */
  async storeCarFile(anchorProofCID: CID, car: CAR): Promise<void> {
    await this.s3store.put(anchorProofCID.toString(), car.bytes)
  }

  async retrieveCarFile(anchorProofCID: CID): Promise<CAR | null> {
    try {
      const carBytes = await this.s3store.get(anchorProofCID.toString())
      return carFactory.fromBytes(carBytes)
    } catch (err) {
      logger.err(
        `Error while retrieving CAR file for anchor proof ${anchorProofCID.toString()} from S3: ${err}`
      )
      return null
    }
  }
}
