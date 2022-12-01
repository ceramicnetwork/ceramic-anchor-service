import { StatusCodes } from 'http-status-codes'
import type { Request as ExpReq, Response as ExpRes } from 'express'
import cors from 'cors'
import { ClassMiddleware, Controller, Get, Post } from '@overnightjs/core'
import { toCID } from '@ceramicnetwork/common'
import type { RequestRepository } from '../repositories/request-repository.js'
import { Request, RequestStatus } from '../models/request.js'
import { logger } from '../logger/index.js'
import { ServiceMetrics as Metrics } from '../service-metrics.js'
import { METRIC_NAMES } from '../settings.js'
import type { CeramicService } from '../services/ceramic-service.js'
import { StreamID } from '@ceramicnetwork/streamid'
import type { RequestPresentationService } from '../services/request-presentation-service'

@Controller('api/v0/requests')
@ClassMiddleware([cors()])
export class RequestController {
  static inject = ['requestPresentationService', 'requestRepository', 'ceramicService'] as const

  constructor(
    private readonly requestPresentationService: RequestPresentationService,
    private readonly requestRepository: RequestRepository,
    private readonly ceramicService: CeramicService
  ) {}

  @Get(':cid')
  private async getStatusForCid(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    logger.debug(`Get info for ${req.params.cid}`)

    try {
      const cid = toCID(req.params.cid)
      if (!cid) {
        return res.status(StatusCodes.BAD_REQUEST).send({
          error: 'CID is empty',
        })
      }
      const request = await this.requestRepository.findByCid(cid)
      if (!request) {
        return res.status(StatusCodes.OK).send({
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

      if (!req.body.cid) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'CID is empty',
        })
      }
      const cid = toCID(req.body.cid)
      if (!req.body.streamId) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'Stream ID is empty',
        })
      }
      const streamId = StreamID.fromString(req.body.streamId)

      let timestamp = undefined // PG translate to `now()`
      if (req.body.timestamp) {
        timestamp = new Date(req.body.timestamp)
      }

      let request = await this.requestRepository.findByCid(cid)
      if (request) {
        const body = await this.requestPresentationService.body(request)
        return res.status(StatusCodes.ACCEPTED).json(body)
      }
      // Intentionally don't await the pinStream promise, let it happen in the background.
      this.ceramicService.pinStream(streamId)
      Metrics.count(METRIC_NAMES.ANCHOR_REQUESTED, 1, { ip_addr: req.ip })

      request = new Request()
      request.cid = cid.toString()
      request.streamId = streamId.toString()
      request.status = RequestStatus.PENDING
      request.message = 'Request is pending.'
      // We don't actually know with certainty that the stream is pinned, since the pinStream
      // call above can fail and swallows errors, but marking it as pinned incorrectly is harmless,
      // and this way we ensure the request is picked up by garbage collection.
      request.pinned = true
      request.timestamp = timestamp

      request = await this.requestRepository.createOrUpdate(request)

      const body = await this.requestPresentationService.body(request)
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
