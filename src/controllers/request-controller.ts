import { StatusCodes } from 'http-status-codes'
import { Request as ExpReq, Response as ExpRes } from 'express'

import { Config } from 'node-config-ts'

import cors from 'cors'
import { ClassMiddleware, Controller, Get, Post } from '@overnightjs/core'

import { toCID } from '@ceramicnetwork/common'
import { AnchorRepository } from '../repositories/anchor-repository.js'
import { RequestRepository } from '../repositories/request-repository.js'
import { Request, RequestStatus } from '../models/request.js'
import { logger } from '../logger/index.js'
import { ServiceMetrics as Metrics } from '../service-metrics.js'
import { METRIC_NAMES } from '../settings.js'
import { RequestPresentation } from '../models/request-presentation.js'
import { CeramicService } from '../services/ceramic-service.js'

@Controller('api/v0/requests')
@ClassMiddleware([cors()])
export class RequestController {
  #requestPresentation: RequestPresentation

  static inject = ['config', 'anchorRepository', 'requestRepository', 'ceramicService'] as const

  constructor(
    private config: Config,
    private anchorRepository: AnchorRepository,
    private requestRepository: RequestRepository,
    private ceramicService: CeramicService
  ) {
    this.#requestPresentation = new RequestPresentation(
      config.schedulerIntervalMS,
      anchorRepository
    )
  }

  @Get(':cid')
  private async getStatusForCid(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    logger.debug(`Get info for ${req.params.cid}`)

    try {
      const cid = toCID(req.params.cid)
      if (cid) {
        const request = await this.requestRepository.findByCid(cid)
        if (request) {
          const body = await this.#requestPresentation.body(request)
          return res.status(StatusCodes.OK).json(body)
        } else {
          return res.status(StatusCodes.OK).send({
            error: "Request doesn't exist",
          })
        }
      } else {
        return res.status(StatusCodes.BAD_REQUEST).send({
          error: 'CID is empty',
        })
      }
    } catch (err) {
      const errmsg = `Loading request status for CID ${req.params.cid} failed: ${err.message}`
      logger.err(errmsg)
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: errmsg,
      })
    }
  }

  @Post()
  private async createRequest(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    try {
      logger.debug(`Create request ${JSON.stringify(req.body)}`)

      const cid = req.body.cid
      // TODO docId check for backwards compat with old Ceramic nodes. Remove once
      //  https://github.com/ceramicnetwork/js-ceramic/issues/1485 has been merged, released, and
      // deployed to a majority of the network.
      const streamId = req.body.streamId || req.body.docId

      if (cid == null) {
        return res.status(StatusCodes.BAD_REQUEST).send({
          error: 'CID is empty',
        })
      }

      if (streamId == null) {
        return res.status(StatusCodes.BAD_REQUEST).send({
          error: 'Stream ID is empty',
        })
      }

      const cidObj = toCID(cid)
      let request = await this.requestRepository.findByCid(cidObj)
      if (request) {
        const body = await this.#requestPresentation.body(request)
        return res.status(StatusCodes.ACCEPTED).json(body)
      } else {
        // Intentionally don't await the pinStream promise, let it happen in the background.
        this.ceramicService.pinStream(streamId)
        Metrics.count(METRIC_NAMES.ANCHOR_REQUESTED, 1, { ip_addr: req.ip })

        request = new Request()
        request.cid = cid.toString()
        request.streamId = streamId
        request.status = RequestStatus.PENDING
        request.message = 'Request is pending.'
        // We don't actually know with certainty that the stream is pinned, since the pinStream
        // call above can fail and swallows errors, but marking it as pinned incorrectly is harmless,
        // and this way we ensure the request is picked up by garbage collection.
        request.pinned = true

        request = await this.requestRepository.createOrUpdate(request)

        const body = await this.#requestPresentation.body(request)
        return res.status(StatusCodes.CREATED).json(body)
      }
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
