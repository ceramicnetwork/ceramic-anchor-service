import type { CompareFunction, Node } from './merkle.js'
import type { Candidate } from './candidate.js'
import { logger } from '../logger/index.js'

/**
 * Implements IPFS merge CIDs
 */
export class IpfsLeafCompare implements CompareFunction<Candidate> {
  compare(left: Node<Candidate>, right: Node<Candidate>): number {
    try {
      // Sort by model first
      const leftModel = left.data.model?.toString()
      const rightModel = right.data.model?.toString()
      if (leftModel !== rightModel) {
        if (leftModel != null) {
          return rightModel == null
            ? -1 // null last
            : leftModel.localeCompare(rightModel)
        }
        return 1 // null last
      }

      // Sort by controller
      // If either value is an object for whatever reason it will
      // be sorted last because "[" < "d" ("[object Object]" vs "did:...")
      const leftController = String(left.data.metadata.controllers[0])
      const rightController = String(right.data.metadata.controllers[0])
      if (leftController !== rightController) {
        return leftController.localeCompare(rightController)
      }

      // Sort by stream ID
      return left.data.streamId.toString().localeCompare(right.data.streamId.toString())
    } catch (err) {
      logger.err(
        `Error while comparing stream ${left.data.streamId.toString()} to stream ${right.data.streamId.toString()}. Error: ${err}`
      )
      throw err
    }
  }
}
