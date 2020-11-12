import { OK, SERVICE_UNAVAILABLE } from "http-status-codes";
import { Request as ExpReq, Response as ExpRes } from 'express';
import { Logger } from '@overnightjs/logger';

import cors from 'cors';
import { ClassMiddleware, Controller, Get } from '@overnightjs/core';

import Context from '../context';
import Contextual from '../contextual';
import AnchorService from '../services/anchor-service';

/**
 * The ServiceInfoController class defines an API endpoint for requests for information about the
 * CeramicAnchorService itself.
 */
@Controller('api/v0/service-info')
@ClassMiddleware([cors()])
export default class ServiceInfoController implements Contextual {
  private anchorService: AnchorService;

  /**
   * Set application context
   * @param context
   */
  setContext(context: Context): void {
    this.anchorService = context.lookup('AnchorService');
  }

  @Get('chainid')
  private async getChainId(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    try {
      return res.status(OK).json({chainId: await this.anchorService.getChainId()})
    } catch (err) {
      Logger.Err(err, true);
      return res.status(SERVICE_UNAVAILABLE).send()
    }
  }
}
