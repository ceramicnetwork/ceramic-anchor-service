import { CARFactory, type CAR } from 'cartonne'
import type { AnchorCommit } from '@ceramicnetwork/common'
import type { CID } from 'multiformats/cid'
import { decode } from 'codeco'
import { pathLine } from '../ancillary/codecs.js'

const carFactory = new CARFactory()

/**
 * Throw an error complaining that block identified by `cid` is not found.
 *
 * @param cid - CID of the block.
 * @param name - Human-readable name of the block, like "Anchor Commit" or "Merkle root".
 */
function raiseNoBlockError(cid: CID, name?: string): never {
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
function copyBlock(source: CAR, destination: CAR, cid: CID, name?: string): void {
  destination.blocks.put(source.blocks.get(cid) || raiseNoBlockError(cid, name))
}

export class InvalidWitnessCARError extends Error {
  constructor(message: string) {
    super(message)
  }
}

/**
 * Emits CIDs that are part of Merkle witness for an anchor commit.
 * Includes CIDs of: the anchor commit, proof record, Merkle root record, nodes of Merkle tree, previous record.
 * Here "previous record" means a Ceramic commit that was requested to be anchored.
 *
 * @param witnessCAR - Witness CAR file.
 */
export function* witnessCIDs(witnessCAR: CAR): Generator<CID> {
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
export function verifyWitnessCAR(witnessCAR: CAR): CID {
  const cidsInvolved = witnessCIDs(witnessCAR)
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

export class WitnessService {
  buildWitnessCAR(anchorCommitCID: CID, merkleCAR: CAR): CAR {
    const car = carFactory.build()
    const anchorCommit = merkleCAR.get(anchorCommitCID) as AnchorCommit
    copyBlock(merkleCAR, car, anchorCommitCID, 'anchor commit')
    const proof = merkleCAR.get(anchorCommit.proof)
    copyBlock(merkleCAR, car, anchorCommit.proof, 'proof of anchor commit')
    const root = merkleCAR.get(proof.root)
    copyBlock(merkleCAR, car, proof.root, 'Merkle root')
    const path = decode(pathLine, anchorCommit.path)
    let currentRecord = root
    for (const pathElement of path) {
      const nextCID = currentRecord[pathElement]
      currentRecord = merkleCAR.get(nextCID)
      if (currentRecord) {
        copyBlock(merkleCAR, car, nextCID, `path element`)
      }
    }
    car.roots.push(anchorCommitCID)
    return car
  }
}
