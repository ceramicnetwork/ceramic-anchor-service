import { BAD_REQUEST, OK } from 'http-status-codes';
import { Request as ExpReq, Response as ExpRes } from 'express';
import { Logger, Logger as logger } from '@overnightjs/logger';

import cors from 'cors';
import { Controller, Get, ClassMiddleware } from '@overnightjs/core';

import Context from '../context';
import AnchorService from '../services/anchor-service';
import Contextual from '../contextual';
import RequestService from '../services/request-service';

import type { Response } from "express-serve-static-core";

@Controller('api/v0/internal')
@ClassMiddleware([cors()])
export default class InternalController implements Contextual {
  private anchorService: AnchorService;
  private requestService: RequestService;

  /**
   * Set application context
   * @param context - app context
   */
  setContext(context: Context): void {
    this.anchorService = context.lookup('AnchorService');
    this.requestService = context.lookup('RequestService');
  }

  @Get()
  private async anchor(req: ExpReq, res: ExpRes): Promise<Response> {
    try {
      logger.Imp('Create anchors');

      await this.anchorService.anchorRequests();

      return res.status(OK).json({
        message: 'anchored pending documents',
      });
    } catch (err) {
      Logger.Err(err, true);
      return res.status(BAD_REQUEST).json({
        error: err.message,
      });
    }
  }
}
