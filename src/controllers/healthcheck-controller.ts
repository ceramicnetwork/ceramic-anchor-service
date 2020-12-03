import { OK, SERVICE_UNAVAILABLE } from "http-status-codes";
import { Request as ExpReq, Response as ExpRes } from 'express';
import { Logger, Logger as logger } from '@overnightjs/logger';

import cors from 'cors';
import { ClassMiddleware, Controller, Get } from '@overnightjs/core';

import { cpuFree, freememPercentage } from "os-utils";
import { singleton } from "tsyringe";

@singleton()
@Controller('api/v0/healthcheck')
@ClassMiddleware([cors()])
export default class HealthcheckController {

  @Get()
  private async get(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    try {
      const freeCpu = await new Promise((resolve) => cpuFree(resolve))
      const freeMem = freememPercentage()
      if (freeCpu < 0.05 || freeMem < 0.20) {
        logger.Err(`Ceramic Anchor Service failed a healthcheck. Info: (freeCpu=${freeCpu}, freeMem=${freeMem})`);
        return res.status(SERVICE_UNAVAILABLE).send()
      }

      return res.status(OK).send()
    } catch (err) {
      Logger.Err(err, true);
      return res.status(SERVICE_UNAVAILABLE).send()
    }
  }
}
