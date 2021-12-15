import { StatusCodes } from 'http-status-codes'
import { Request as ExpReq, Response as ExpRes } from 'express'

import { Config } from 'node-config-ts'

import cors from 'cors'
import { ClassMiddleware, Controller, Get, Post } from '@overnightjs/core'

import CID from 'cids'
import { RequestStatus } from '../models/request-status'
import AnchorRepository from '../repositories/anchor-repository'
import RequestRepository from '../repositories/request-repository'
import { Request } from '../models/request'
import { inject, singleton } from 'tsyringe'
import { logger } from '../logger'
import { RequestPresentation } from '../models/request-presentation'
import { CeramicService } from '../services/ceramic-service'

@singleton()
@Controller('api/v0/requests')
@ClassMiddleware([cors()])
export default class RequestController {
  #requestPresentation: RequestPresentation

  constructor(
    @inject('config') private config?: Config,
    @inject('anchorRepository') private anchorRepository?: AnchorRepository,
    @inject('requestRepository') private requestRepository?: RequestRepository,
    @inject('ceramicService') private ceramicService?: CeramicService
  ) {
    this.#requestPresentation = new RequestPresentation(config.cronExpression, anchorRepository)
  }

  @Get(':cid')
  private async getStatusForCid(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    logger.debug(`Get info for ${req.params.cid}`)

    try {
      const cid = new CID(req.params.cid)
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

      const cidObj = new CID(cid)
      let request = await this.requestRepository.findByCid(cidObj)
      if (request) {
        const body = await this.#requestPresentation.body(request)
        return res.status(StatusCodes.ACCEPTED).json(body)
      } else {
        // Intentionally don't await the pinStream promise, let it happen in the background.
        this.ceramicService.pinStream(streamId)

        request = new Request()
        request.cid = cid.toString()
        request.streamId = streamId
        request.status = RequestStatus.PENDING
        request.message = 'Request is pending.'
        request.pinned = true

        request = await this.requestRepository.createOrUpdate(request)

        const body = await this.#requestPresentation.body(request)
        return res.status(StatusCodes.CREATED).json(body)
      }
    } catch (err) {
      const errmsg = `Creating request with streamId ${req.body.streamId} and commit CID ${req.body.cid} failed: ${err.message}`
      logger.err(errmsg)
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: errmsg,
      })
    }
  }
}
