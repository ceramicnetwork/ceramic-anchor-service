import { Request as ExpReq, Response as ExpRes } from 'express'
import { logger } from '../logger/index.js'
import { StatusCodes } from 'http-status-codes'

import cors from 'cors'
import { Controller, ClassMiddleware, Post } from '@overnightjs/core'

import { AnchorService } from '../services/anchor-service.js'
import { ServiceMetrics as Metrics } from '@ceramicnetwork/observability'
import { METRIC_NAMES } from '../settings.js'

import type { Response } from 'express-serve-static-core'

@Controller('api/v0/anchors')
@ClassMiddleware([cors()])
export class AnchorController {
  static inject = ['anchorService'] as const

  constructor(private readonly anchorService: AnchorService) {}

  @Post()
  async anchor(_req: ExpReq, res: ExpRes): Promise<Response> {
    const before = performance.now()
    try {
      await this.anchorService.anchorRequests()

      const after = performance.now()
      Metrics.record(METRIC_NAMES.ANCHOR_REQUESTS_BATCH_TIME, after - before)

      return res.status(StatusCodes.OK).json({
        message: 'anchored pending streams',
      })
    } catch (err: any) {
      const errmsg = `Anchoring pending streams failed: ${err.message}`
      logger.err(errmsg)

      const after = performance.now()
      Metrics.record(METRIC_NAMES.ANCHOR_REQUESTS_BATCH_FAILURE_TIME, after - before)

      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: errmsg,
      })
    }
  }
}
