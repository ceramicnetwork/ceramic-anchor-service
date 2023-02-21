import { StatusCodes } from 'http-status-codes'
import { Request as ExpReq, Response as ExpRes } from 'express'
import cors from 'cors'
import { ClassMiddleware, Controller, Get } from '@overnightjs/core'
import type { IHealthcheckService } from '../services/healthcheck-service.js'

@Controller('api/v0/healthcheck')
@ClassMiddleware([cors()])
export class HealthcheckController {
  static inject = ['healthcheckService'] as const

  constructor(private readonly healthcheckService: IHealthcheckService) {}

  @Get()
  async get(_req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    const isOK = await this.healthcheckService.isOK()
    if (isOK) {
      return res.status(StatusCodes.OK).send()
    } else {
      return res.status(StatusCodes.SERVICE_UNAVAILABLE).send()
    }
  }
}
