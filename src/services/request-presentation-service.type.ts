import type { Request } from '../models/request.js'

export interface IRequestPresentationService {
  body(request: Request): Promise<any>
}
