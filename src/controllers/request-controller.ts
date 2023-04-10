import { StatusCodes } from 'http-status-codes'
import { Request as ExpReq, Response as ExpRes } from 'express'

import cors from 'cors'
import { ClassMiddleware, Controller, Get, Middleware, Post } from '@overnightjs/core'

import { NonEmptyArray } from '@ceramicnetwork/common'
import { logger } from '../logger/index.js'
import { ServiceMetrics as Metrics } from '@ceramicnetwork/observability'
import { METRIC_NAMES } from '../settings.js'
import {
  AnchorRequestParamsParser,
  RequestAnchorParams,
} from '../ancillary/anchor-request-params-parser.js'
import bodyParser from 'body-parser'
import * as t from 'codeco'
import * as te from '../ancillary/io-ts-extra.js'
import type { RequestService } from '../services/request-service.js'

/*
 * Get origin from a request from `did` header.
 *
 * If not found, use X-Forwarded-For header as origin.
 * Parsing according to https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For#parsing
 *
 * If no header found, use IP address of the requester.
 */
function parseOrigin(req: ExpReq): string {
  const didHeader = req.get('did')
  if (didHeader) return didHeader
  const sourceIp = req.get('sourceIp')
  if (sourceIp) return sourceIp
  let addresses = req.ip
  const xForwardedForHeader = req.get('X-Forwarded-For')
  if (xForwardedForHeader) {
    if (Array.isArray(xForwardedForHeader)) {
      addresses = xForwardedForHeader.join(',')
    } else {
      addresses = xForwardedForHeader
    }
  }
  const addressesSplit = addresses.split(',') as NonEmptyArray<string>
  return addressesSplit[0].trim()
}

const GetStatusParams = t.exact(
  t.type({
    cid: t.string.pipe(te.cidAsString),
  })
)

@Controller('api/v0/requests')
@ClassMiddleware([cors()])
export class RequestController {
  static inject = ['anchorRequestParamsParser', 'requestService'] as const

  constructor(
    private readonly anchorRequestParamsParser: AnchorRequestParamsParser,
    private readonly requestService: RequestService
  ) {}

  @Get(':cid')
  async getStatusForCid(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    const paramsE = GetStatusParams.decode(req.params)
    if (isLeft(paramsE)) {
      logger.err(makeErrorMessage(paramsE.left))
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: 'CID is empty or malformed',
      })
    }
    const cid = paramsE.right.cid
    logger.debug(`Get info for ${cid}`)

    try {
      const response = await this.requestService.getStatusForCid(cid)
      return res.status(StatusCodes.OK).json(response)
    } catch (err: any) {
      const errmsg = `Loading request status for CID ${cid} failed: ${err.message}`
      logger.err(errmsg)
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: errmsg,
      })
    }
  }

  @Post()
  @Middleware([bodyParser.raw({ type: 'application/vnd.ipld.car' })])
  async createRequest(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    const origin = parseOrigin(req)

    logger.debug(`Create request ${JSON.stringify(req.body)}`)

    const validation = this.anchorRequestParamsParser.parse(req)

    if (t.isLeft(validation)) {
      logger.err(makeErrorMessage(validation.left))
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: t.report(validation).join(';'),
      })
    }
    const requestParams = validation.right

    try {
      const found = await this.requestService.findByCid(requestParams.cid)
      if (found) {
        return res.status(StatusCodes.ACCEPTED).json(found)
      }

      const body = await this.requestService.createOrUpdate(requestParams, origin)

      Metrics.count(METRIC_NAMES.ANCHOR_REQUESTED, 1, { source: parseOrigin(req) })

      return res.status(StatusCodes.CREATED).json(body)
    } catch (err: any) {
      return this.getBadRequestResponse(res, err, requestParams, origin)
    }
  }

  private getBadRequestResponse(
    res: ExpRes,
    err: Error,
    requestParams: RequestAnchorParams,
    origin: string
  ): ExpRes {
    const errmsg = `Creating request with streamId ${requestParams.streamId} and commit CID ${requestParams.cid} from ${origin} failed: ${err.message}`
    logger.err(errmsg)
    logger.err(err) // Log stack trace
    return res.status(StatusCodes.BAD_REQUEST).json({
      error: errmsg,
    })
  }
}
