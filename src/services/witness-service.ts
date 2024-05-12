import { CARFactory, type CAR } from 'cartonne'
import type { AnchorCommit } from '@ceramicnetwork/common'
import type { CID } from 'multiformats/cid'
import { decode } from 'codeco'
import { pathLine } from '../ancillary/codecs.js'
import { LRUCache } from 'least-recent'
import { Config } from 'node-config-ts'
import { DynamoDB } from '@aws-sdk/client-dynamodb'
import { logger } from '../logger/index.js'
import { Utils } from '../utils.js'

const carFactory = new CARFactory()

const WITNESS_TABLE_CREATION_RETRIES = 3
const WITNESS_TABLE_CREATION_WAIT_MS = 5000
const WITNESS_CAR_CACHE = 2 * 6144 // Two anchor batches ≈ 24MiB if one witness car ≈ 2KiB
const DEFAULT_WITNESS_TABLE_NAME = 'cas-anchor-witness'
const DEFAULT_WITNESS_TABLE_TTL = '86400' // 1 day

/**
 * A service for building, storing, retrieving, and verifying the witness CAR file containing all the information needed
 * to verify an anchor commit, viz. the anchor commit itself, the anchor proof, and the Merkle tree nodes along the path
 * to the anchored commit CID.
 */
export interface IWitnessService {
  init(): Promise<void>
  cids(witnessCAR: CAR): Generator<CID>
  verify(witnessCAR: CAR): CID
  build(anchorCommitCID: CID, merkleCAR: CAR): CAR
  get(anchorCommitCID: CID): Promise<CAR | undefined>
  store(anchorCommitCID: CID, witnessCAR: CAR): Promise<void>
}

/**
 * Factory for IWitnessService.
 */
export function makeWitnessService(config: Config): IWitnessService {
  const mode = config.witnessStorage.mode
  switch (mode) {
    case 'dynamodb':
      return new DynamoDbWitnessService(config)
    case 'inmemory':
    default:
      return new InMemoryWitnessService()
  }
}
makeWitnessService.inject = ['config'] as const

export class InvalidWitnessCARError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export class WitnessService {
  /**
   * Throw an error complaining that block identified by `cid` is not found.
   *
   * @param cid - CID of the block.
   * @param name - Human-readable name of the block, like "Anchor Commit" or "Merkle root".
   */
  raiseNoBlockError(cid: CID, name?: string): never {
    const suffix = name ? `for ${name}` : ''
    throw new Error(`Can not find ${cid} in merkle CAR ${suffix}`.trimEnd())
  }

  /**
   * Copy block identified by `cid` from `source` CAR file to `destination` CAR file.
   *
   * @param source - Source CAR file.
   * @param destination - Destination CAR file.
   * @param cid - CID identifier of a block to copy.
   * @param name - human name of the block, used when throwing an error.
   */
  copyBlock(source: CAR, destination: CAR, cid: CID, name?: string): void {
    destination.blocks.put(source.blocks.get(cid) || this.raiseNoBlockError(cid, name))
  }

  /**
   * Emits CIDs that are part of Merkle witness for an anchor commit.
   * Includes CIDs of: the anchor commit, proof record, Merkle root record, nodes of Merkle tree, previous record.
   * Here "previous record" means a Ceramic commit that was requested to be anchored.
   *
   * @param witnessCAR - Witness CAR file.
   */
  *cids(witnessCAR: CAR): Generator<CID> {
    const anchorCommitCID = witnessCAR.roots[0]
    if (!anchorCommitCID)
      throw new InvalidWitnessCARError(`No root found: expected anchor commit CID`)
    yield anchorCommitCID
    const anchorCommit = witnessCAR.get(anchorCommitCID) as AnchorCommit
    if (!anchorCommit) throw new InvalidWitnessCARError(`No anchor commit found`)
    const proof = witnessCAR.get(anchorCommit.proof)
    if (!proof) throw new InvalidWitnessCARError(`No proof found`)
    yield anchorCommit.proof
    const root = witnessCAR.get(proof.root)
    if (!root) throw new InvalidWitnessCARError(`No Merkle root found`)
    yield proof.root
    const path = decode(pathLine, anchorCommit.path)

    let currentRecord = root
    let currentCID = root[0]
    for (const p of path) {
      if (!currentRecord) throw new InvalidWitnessCARError(`Missing witness node`)
      currentCID = currentRecord[p]
      if (!currentCID) throw new InvalidWitnessCARError(`Missing witness node`)
      yield currentCID
      currentRecord = witnessCAR.get(currentCID)
    }
  }

  /**
   * Extract Anchor Commit and verify if its Merkle path goes from Merkle root to the `.prev` commit.
   *
   * @param witnessCAR - CAR file containing Merkle witness i.e. Anchor Commit, proof, Merkle root, and all the intermediary nodes.
   */
  verify(witnessCAR: CAR): CID {
    const cidsInvolved = this.cids(witnessCAR)
    const anchorCommitCID = cidsInvolved.next().value
    let witnessLink = anchorCommitCID
    for (const cid of cidsInvolved) {
      witnessLink = cid
    }
    const anchorCommit = witnessCAR.get(anchorCommitCID)
    if (!witnessLink.equals(anchorCommit.prev)) {
      throw new InvalidWitnessCARError(`Invalid Merkle witness`)
    }
    return anchorCommitCID
  }

  build(anchorCommitCID: CID, merkleCAR: CAR): CAR {
    const car = carFactory.build()
    const anchorCommit = merkleCAR.get(anchorCommitCID) as AnchorCommit
    this.copyBlock(merkleCAR, car, anchorCommitCID, 'anchor commit')
    const proof = merkleCAR.get(anchorCommit.proof)
    this.copyBlock(merkleCAR, car, anchorCommit.proof, 'proof of anchor commit')
    const root = merkleCAR.get(proof.root)
    this.copyBlock(merkleCAR, car, proof.root, 'Merkle root')
    const path = decode(pathLine, anchorCommit.path)
    let currentRecord = root
    for (const pathElement of path) {
      const nextCID = currentRecord[pathElement]
      currentRecord = merkleCAR.get(nextCID)
      if (currentRecord) {
        this.copyBlock(merkleCAR, car, nextCID, `path element`)
      }
    }
    car.roots.push(anchorCommitCID)
    return car
  }
}

export class DynamoDbWitnessService extends WitnessService implements IWitnessService {
  private readonly tableName: string
  private readonly ttl: string
  private readonly dynamoDb: DynamoDB

  constructor(config: Config) {
    super()
    this.dynamoDb = new DynamoDB({
      region: config.witnessStorage.awsRegion,
      endpoint: config.witnessStorage.dynamoDbEndpoint,
    })
    this.tableName = config.witnessStorage.dynamoDbTableName || DEFAULT_WITNESS_TABLE_NAME
    this.ttl = config.witnessStorage.dynamoDbTtl || DEFAULT_WITNESS_TABLE_TTL
  }

  async init(): Promise<void> {
    // Create the table if it doesn't exist
    await this.createTable(WITNESS_TABLE_CREATION_RETRIES)
  }

  async createTable(retries: number): Promise<void> {
    try {
      await this.dynamoDb.describeTable({ TableName: this.tableName })
      logger.debug(`Table ${this.tableName} exists`)
    } catch (err) {
      try {
        await this.dynamoDb.createTable({
          TableName: this.tableName,
          KeySchema: [{ AttributeName: 'cid', KeyType: 'HASH' }],
          AttributeDefinitions: [{ AttributeName: 'cid', AttributeType: 'S' }],
          BillingMode: 'PAY_PER_REQUEST',
        })
        // Enable TTL for the table
        await this.dynamoDb.updateTimeToLive({
          TableName: this.tableName,
          TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
        })
        logger.debug(`Created table ${this.tableName}`)
      } catch (err) {
        retries--
        const msg = `Failed to create table ${this.tableName}: ${err}`
        if (retries <= 0) {
          throw new Error(msg)
        }
        Utils.delay(WITNESS_TABLE_CREATION_WAIT_MS).then(() => {
          this.createTable(retries)
        })
      }
    }
  }

  async get(anchorCommitCID: CID): Promise<CAR | undefined> {
    try {
      const commandOutput = await this.dynamoDb.getItem({
        TableName: this.tableName,
        Key: { cid: { S: anchorCommitCID.toString() } },
        AttributesToGet: ['car'],
      })
      if (commandOutput.Item && commandOutput.Item['car']) {
        return carFactory.fromBytes(commandOutput.Item['car'].B as Uint8Array)
      }
    } catch (err) {
      logger.err(`Failed to fetch witness CAR from DynamoDB: ${err}`)
    }
    return undefined
  }

  async store(anchorCommitCID: CID, witnessCAR: CAR): Promise<void> {
    try {
      await this.dynamoDb.putItem({
        TableName: this.tableName,
        Item: {
          cid: { S: anchorCommitCID.toString() },
          car: { B: witnessCAR.bytes },
          ttl: { N: (Math.floor(Date.now() / 1000) + parseInt(this.ttl)).toString() },
        },
      })
    } catch (err) {
      logger.err(`Failed to store witness CAR in DynamoDB: ${err}`)
    }
  }
}

export class InMemoryWitnessService extends WitnessService implements IWitnessService {
  private readonly cache = new LRUCache<string, CAR>(WITNESS_CAR_CACHE)

  async init(): Promise<void> {
    return Promise.resolve()
  }

  get(anchorCommitCID: CID): Promise<CAR | undefined> {
    return Promise.resolve(this.cache.get(anchorCommitCID.toString()))
  }

  store(anchorCommitCID: CID, witnessCAR: CAR): Promise<void> {
    return Promise.resolve(this.cache.set(anchorCommitCID.toString(), witnessCAR))
  }
}
