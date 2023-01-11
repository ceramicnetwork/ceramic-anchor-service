import { Anchor } from '../models/anchor.js'
import type { Request } from '../models/request.js'
import type { Options } from './repository-types.js'

export class AnchorWithRequest extends Anchor {
  request: Request
}

export interface IAnchorRepository {
  createAnchors(anchors: Array<Anchor>, options?: Options): Promise<void>
  findByRequest(request: Request, options?: Options): Promise<AnchorWithRequest>
}
