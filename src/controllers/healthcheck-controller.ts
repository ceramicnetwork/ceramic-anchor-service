import httpStatusCodes from 'http-status-codes'
import { Request as ExpReq, Response as ExpRes } from 'express'
import cors from 'cors'
import { ClassMiddleware, Controller, Get } from '@overnightjs/core'
import { cpuFree, freememPercentage } from 'os-utils'
import { logger } from '../logger/index.js'

const { OK, SERVICE_UNAVAILABLE } = httpStatusCodes

@Controller('api/v0/healthcheck')
@ClassMiddleware([cors()])
export class HealthcheckController {
  @Get()
  private async get(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    try {
      const freeCpu = await new Promise((resolve) => cpuFree(resolve))
      const freeMem = freememPercentage()
      if (freeCpu < 0.05 || freeMem < 0.2) {
        logger.err(
          `Ceramic Anchor Service failed a healthcheck. Info: (freeCpu=${freeCpu}, freeMem=${freeMem})`
        )
        return res.status(SERVICE_UNAVAILABLE).send()
      }

      return res.status(OK).send()
    } catch (err) {
      logger.err(`Failed to run healthcheck: ${err.message()}`)
      return res.status(SERVICE_UNAVAILABLE).send()
    }
  }
}
