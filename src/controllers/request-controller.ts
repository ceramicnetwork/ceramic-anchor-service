import { StatusCodes } from 'http-status-codes'
import { Request as ExpReq, Response as ExpRes } from 'express'

import cors from 'cors'
import { ClassMiddleware, Controller, Get, Middleware, Post } from '@overnightjs/core'

import { NonEmptyArray } from '@ceramicnetwork/common'
import { Request, RequestStatus } from '../models/request.js'
import { logger } from '../logger/index.js'
import { ServiceMetrics as Metrics } from '@ceramicnetwork/observability'
import { METRIC_NAMES } from '../settings.js'
import type { IRequestPresentationService } from '../services/request-presentation-service.type.js'
import type { RequestRepository } from '../repositories/request-repository.js'
import type { IMetadataService } from '../services/metadata-service.js'
import {
  AnchorRequestParamsParser,
  isRequestAnchorParamsV2,
} from '../ancillary/anchor-request-params-parser.js'
import bodyParser from 'body-parser'
import { isLeft } from 'fp-ts/lib/Either.js'
import { makeErrorMessage } from '../ancillary/throw-decoder.js'
import * as t from 'io-ts'
import * as te from '../ancillary/io-ts-extra.js'

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
  static inject = [
    'requestRepository',
    'requestPresentationService',
    'metadataService',
    'anchorRequestParamsParser',
  ] as const

  constructor(
    private readonly requestRepository: RequestRepository,
    private readonly requestPresentationService: IRequestPresentationService,
    private readonly metadataService: IMetadataService,
    private readonly anchorRequestParamsParser: AnchorRequestParamsParser
  ) {}

  @Get(':cid')
  async getStatusForCid(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    const paramsE = GetStatusParams.decode(req.params)
    if (isLeft(paramsE)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: 'CID is empty or malformed',
      })
    }
    const cid = paramsE.right.cid
    logger.debug(`Get info for ${cid}`)

    try {
      const request = await this.requestRepository.findByCid(cid)
      if (!request) {
        return res.status(StatusCodes.OK).json({
          error: "Request doesn't exist",
        })
      }

      const body = await this.requestPresentationService.body(request)
      return res.status(StatusCodes.OK).json(body)
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
    try {
      logger.debug(`Create request ${JSON.stringify(req.body)}`)

      const validation = this.anchorRequestParamsParser.parse(req)

      if (isLeft(validation)) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: makeErrorMessage(validation.left),
        })
      }

      const requestParams = validation.right

      const cid = requestParams.cid
      const streamId = requestParams.streamId

      const timestamp = requestParams.timestamp ?? new Date()

      const found = await this.requestRepository.findByCid(cid)
      if (found) {
        const body = await this.requestPresentationService.body(found)
        return res.status(StatusCodes.ACCEPTED).json(body)
      }

      // Store metadata from genesis to the database
      // TODO CDB-2151 This should be moved out of RequestController
      if (isRequestAnchorParamsV2(requestParams)) {
        await this.metadataService.fill(streamId, requestParams.genesisFields)
      } else {
        await this.metadataService.fillFromIpfs(streamId)
      }

      // Intentionally don't await the pinStream promise, let it happen in the background.
      Metrics.count(METRIC_NAMES.ANCHOR_REQUESTED, 1, { source: parseOrigin(req) })

      const request = new Request()
      request.cid = cid.toString()
      request.origin = origin
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
    } catch (err: any) {
      return this.getBadRequestResponse(req, res, err, origin)
    }
  }

  private getBadRequestResponse(req: ExpReq, res: ExpRes, err: Error, origin: string): ExpRes {
    const errmsg = `Creating request with streamId ${req.body.streamId} and commit CID ${req.body.cid} from ${origin} failed: ${err.message}`
    logger.err(errmsg)
    logger.err(err) // Log stack trace
    return res.status(StatusCodes.BAD_REQUEST).json({
      error: errmsg,
    })
  }
}
