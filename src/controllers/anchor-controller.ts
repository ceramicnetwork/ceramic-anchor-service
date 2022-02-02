import httpStatusCodes from 'http-status-codes'
import { Request as ExpReq, Response as ExpRes } from 'express'
import { logger } from '../logger/index.js'

import cors from 'cors'
import { Controller, Get, ClassMiddleware, Post } from '@overnightjs/core'

import { AnchorService } from '../services/anchor-service.js'

import type { Response } from 'express-serve-static-core'
import { singleton } from 'tsyringe'

const { INTERNAL_SERVER_ERROR, OK } = httpStatusCodes
@singleton()
@Controller('api/v0/anchors')
@ClassMiddleware([cors()])
export class AnchorController {
  constructor(private anchorService: AnchorService) {}

  @Post()
  private async anchor(req: ExpReq, res: ExpRes): Promise<Response> {
    try {
      await this.anchorService.anchorRequests()

      return res.status(OK).json({
        message: 'anchored pending streams',
      })
    } catch (err) {
      const errmsg = `Anchoring pending streams failed: ${err.message}`
      logger.err(errmsg)
      return res.status(INTERNAL_SERVER_ERROR).json({
        error: errmsg,
      })
    }
  }
}
