import httpStatusCodes from 'http-status-codes'
import { Request as ExpReq, Response as ExpRes } from 'express'
import { logger } from '../logger/index.js'

import cors from 'cors'
import { Controller, Get, ClassMiddleware, Post } from '@overnightjs/core'

import { AnchorService } from '../services/anchor-service.js'
import { ServiceMetrics as Metrics } from '../service-metrics.js'
import { METRIC_NAMES } from '../settings.js'

import type { Response } from 'express-serve-static-core'
import { singleton } from 'tsyringe'

const { INTERNAL_SERVER_ERROR, OK } = httpStatusCodes
@singleton()
@Controller('api/v0/anchors')
@ClassMiddleware([cors()])
export class AnchorController {

  static inject = ['anchorService'] as const

  constructor(private anchorService: AnchorService) {}

  @Post()
  private async anchor(req: ExpReq, res: ExpRes): Promise<Response> {
    const before = performance.now()
    try {
      await this.anchorService.anchorRequests()

      const after = performance.now()
      Metrics.record(METRIC_NAMES.ANCHOR_REQUESTS_BATCH_TIME, after - before)

      return res.status(OK).json({
        message: 'anchored pending streams',
      })
    } catch (err) {
      const errmsg = `Anchoring pending streams failed: ${err.message}`
      logger.err(errmsg)

      const after = performance.now()
      Metrics.record(METRIC_NAMES.ANCHOR_REQUESTS_BATCH_FAILURE_TIME, after - before)

      return res.status(INTERNAL_SERVER_ERROR).json({
        error: errmsg,
      })
    }
  }
}
