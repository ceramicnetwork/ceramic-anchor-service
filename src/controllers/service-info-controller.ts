import { OK, SERVICE_UNAVAILABLE } from "http-status-codes";
import { Request as ExpReq, Response as ExpRes } from 'express';
import { Logger } from '@overnightjs/logger';

import cors from 'cors';
import { ClassMiddleware, Controller, Get } from '@overnightjs/core';

import BlockchainService from '../services/blockchain/blockchain-service';
import { inject, singleton } from "tsyringe";

/**
 * The ServiceInfoController class defines an API endpoint for requests for information about the
 * CeramicAnchorService itself.
 */
@singleton()
@Controller('api/v0/service-info')
@ClassMiddleware([cors()])
export default class ServiceInfoController {

  constructor(
    @inject("blockchainService") private blockchainService?: BlockchainService) {
  }

  @Get('supported_chains')
  private async getSupportedChains(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    try {
      return res.status(OK).json({supportedChains: [this.blockchainService.chainId]})
    } catch (err) {
      Logger.Err(err, true);
      return res.status(SERVICE_UNAVAILABLE).send()
    }
  }
}
