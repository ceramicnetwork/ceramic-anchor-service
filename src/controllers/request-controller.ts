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
  RequestAnchorParamsCodec,
} from '../ancillary/anchor-request-params-parser.js'
import bodyParser from 'body-parser'
import { type RequestService, RequestDoesNotExistError } from '../services/request-service.js'
import { cidAsString } from '@ceramicnetwork/codecs'
import { isLeft, report, string, strict, validate } from 'codeco'

/*
 * Get origin from a request from `did` header.
 *
 * If not found, use X-Forwarded-For header as origin.
 * Parsing according to https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For#parsing
 *
 * If no header found, use IP address of the requester.
 */
function parseOrigin(req: ExpReq): string {
  const didHeader = parseOriginDID(req)
  if (didHeader) return didHeader
  return parseOriginIP(req)
}

function parseOriginIP(req: ExpReq): string {
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

function parseOriginDID(req: ExpReq): string | undefined {
  return req.get('did')
}

const GetStatusParams = strict({
  cid: string.pipe(cidAsString),
})

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
    const paramsE = validate(GetStatusParams, req.params)
    if (isLeft(paramsE)) {
      logger.err(report(paramsE).join(';'))
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: 'CID is empty or malformed',
      })
    }
    const cid = paramsE.right.cid
    logger.debug(`Getting info for ${cid}`)

    try {
      const response = await this.requestService.getStatusForCid(cid)
      return res.status(StatusCodes.OK).json(response)
    } catch (err: any) {
      if (err instanceof RequestDoesNotExistError) {
        Metrics.count(METRIC_NAMES.C_REQUEST_NOT_FOUND, 1, { source: parseOrigin(req) })
        return res.status(StatusCodes.NOT_FOUND).json({
          error: err.message,
        })
      }

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

    const validation = this.anchorRequestParamsParser.parse(req)

    if (isLeft(validation)) {
      const errorMessage = report(validation).join(';')
      logger.err(errorMessage)
      Metrics.count(METRIC_NAMES.C_INVALID_REQUEST, 1, { source: parseOrigin(req) })
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: errorMessage,
      })
    }
    const requestParams = validation.right

    logger.debug(
      `Creating request ${JSON.stringify(RequestAnchorParamsCodec.encode(requestParams))}`
    )

    try {
      const body = await this.requestService.create(requestParams, origin)

      // request was newly created
      if (body) {
        Metrics.count(METRIC_NAMES.C_NEW_ANCHOR_REQUEST, 1, { source: parseOrigin(req) })
        return res.status(StatusCodes.CREATED).json(body)
      }

      // request already exists so retrieve it
      const found = await this.requestService.findByCid(requestParams.cid)
      if (!found) {
        throw new Error(
          `Request with cid ${requestParams.cid} was not created and not found. This should not happen`
        )
      }
      logger.debug(`Found request for ${requestParams.cid} of stream ${requestParams.streamId}`)
      Metrics.count(METRIC_NAMES.C_FOUND_EXISTING_REQUEST, 1, { source: parseOrigin(req) })
      return res.status(StatusCodes.ACCEPTED).json(found)
    } catch (err: any) {
      Metrics.count(METRIC_NAMES.C_ERROR_CREATING_REQUEST, 1, { source: parseOrigin(req) })
      return this.getBadRequestResponse(
        res,
        err,
        requestParams,
        parseOriginDID(req) || 'none',
        parseOriginIP(req)
      )
    }
  }

  private getBadRequestResponse(
    res: ExpRes,
    err: Error,
    requestParams: RequestAnchorParams,
    originDID: string,
    originIP: string
  ): ExpRes {
    const errmsg = `Creating request with streamId ${requestParams.streamId} and commit CID ${requestParams.cid} from IP: ${originIP} and DID: ${originDID}  failed: ${err.message}`
    logger.err(errmsg)
    logger.err(err) // Log stack trace
    return res.status(StatusCodes.BAD_REQUEST).json({
      error: errmsg,
    })
  }
}
