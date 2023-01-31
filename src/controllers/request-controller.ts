import { StatusCodes } from 'http-status-codes'
import { Request as ExpReq, Response as ExpRes } from 'express'

import cors from 'cors'
import { ClassMiddleware, Controller, Get, Post } from '@overnightjs/core'

import { toCID } from '@ceramicnetwork/common'
import { StreamID } from '@ceramicnetwork/streamid'
import { Request, RequestStatus } from '../models/request.js'
import { logger } from '../logger/index.js'
import { ServiceMetrics as Metrics } from '@ceramicnetwork/observability'
import { METRIC_NAMES } from '../settings.js'
import type { IRequestPresentationService } from '../services/request-presentation-service.type.js'
import type { RequestRepository } from '../repositories/request-repository.js'
import type { IMetadataService } from '../services/metadata-service.js'

/*
 * Get origin from a request from X-Forwarded-For.
 * Parsing according to https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For#parsing
 *
 * If no header found, use IP address of the requester.
 *
 * TODO CDB-2185 Get it from DID signer first.
 */
function parseOrigin(req: ExpReq): string {
  let addresses = req.ip
  const xForwardedForHeader = req.get('X-Forwarded-For')
  if (xForwardedForHeader) {
    if (Array.isArray(xForwardedForHeader)) {
      addresses = xForwardedForHeader.join(',')
    } else {
      addresses = xForwardedForHeader
    }
  }
  return addresses.split(',')[0].trim()
}

@Controller('api/v0/requests')
@ClassMiddleware([cors()])
export class RequestController {
  static inject = [
    'requestRepository',
    'requestPresentationService',
    'metadataService',
  ] as const

  constructor(
    private readonly requestRepository: RequestRepository,
    private readonly requestPresentationService: IRequestPresentationService,
    private readonly metadataService: IMetadataService
  ) {}

  @Get(':cid')
  private async getStatusForCid(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    logger.debug(`Get info for ${req.params.cid}`)

    try {
      const cid = toCID(req.params.cid)
      if (!cid) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'CID is empty',
        })
      }
      const request = await this.requestRepository.findByCid(cid)
      if (!request) {
        return res.status(StatusCodes.OK).json({
          error: "Request doesn't exist",
        })
      }

      const body = await this.requestPresentationService.body(request)
      return res.status(StatusCodes.OK).json(body)
    } catch (err) {
      const errmsg = `Loading request status for CID ${req.params.cid} failed: ${err.message}`
      logger.err(errmsg)
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: errmsg,
      })
    }
  }

  @Post()
  async createRequest(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    try {
      logger.debug(`Create request ${JSON.stringify(req.body)}`)

      const cidInput = req.body.cid
      if (!cidInput) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'CID is empty',
        })
      }
      const cid = toCID(cidInput)

      if (!req.body.streamId) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'Stream ID is empty',
        })
      }
      const streamId = StreamID.fromString(req.body.streamId)

      const found = await this.requestRepository.findByCid(cid)
      if (found) {
        const body = await this.requestPresentationService.body(found)
        return res.status(StatusCodes.ACCEPTED).json(body)
      }

      let timestamp = new Date()
      if (req.body.timestamp) {
        timestamp = new Date(req.body.timestamp)
      }

      // Store metadata from genesis to the database
      // TODO CDB-2151 This should be moved out of RequestController
      await this.metadataService.fill(streamId)

      // Intentionally don't await the pinStream promise, let it happen in the background.
      Metrics.count(METRIC_NAMES.ANCHOR_REQUESTED, 1, { ip_addr: req.ip })

      const request = new Request()
      request.cid = cid.toString()
      request.origin = parseOrigin(req)
      request.streamId = streamId.toString()
      request.status = RequestStatus.PENDING
      request.message = 'Request is pending.'
      // We don't actually know with certainty that the stream is pinned, since the pinStream
      // call above can fail and swallows errors, but marking it as pinned incorrectly is harmless,
      // and this way we ensure the request is picked up by garbage collection.
      request.pinned = true
      request.timestamp = timestamp

      const storedRequest = await this.requestRepository.createOrUpdate(request)
      await this.requestRepository.markPreviousReplaced(storedRequest)

      const body = await this.requestPresentationService.body(storedRequest)
      return res.status(StatusCodes.CREATED).json(body)
    } catch (err) {
      const errmsg = `Creating request with streamId ${req.body.streamId} and commit CID ${req.body.cid} failed: ${err.message}`
      logger.err(errmsg)
      logger.err(err) // Log stack trace
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: errmsg,
      })
    }
  }
}
