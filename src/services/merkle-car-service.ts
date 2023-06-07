import { CARFactory, CAR } from 'cartonne'
import type { CID } from 'multiformats/cid'
import AWSSDK from 'aws-sdk'
import LevelUp from 'levelup'
import S3LevelDOWN from 's3leveldown'
import * as DAG_JOSE from 'dag-jose'
import { logger } from '../logger/index.js'

/**
 * A service for storing and retrieving the CAR file containing the entire anchor merkle tree,
 * along with the associated anchor proof and anchor commits.
 */
export interface IMerkleCarService {
  storeCarFile(anchorProofCID: CID, car: CAR): Promise<void>
  retrieveCarFile(anchorProofCID: CID): Promise<CAR | null>
}

export class InMemoryMerkleCarService {
  readonly cars: Map<string, CAR> = new Map()

  async storeCarFile(anchorProofCID: CID, car: CAR): Promise<void> {
    this.cars.set(anchorProofCID.toString(), car)
  }

  async retrieveCarFile(anchorProofCID: CID): Promise<CAR | null> {
    return this.cars.get(anchorProofCID.toString()) || null
  }
}

const S3_STORE_PATH = '/ceramic/cas/anchor/merkle-car/'
const carFactory = new CARFactory()
carFactory.codecs.add(DAG_JOSE)

export class S3MerkleCarService {
  readonly s3store: LevelUp.LevelUp = new LevelUp(new S3LevelDOWN(S3_STORE_PATH, new AWSSDK.S3()))

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
