import { INTERNAL_SERVER_ERROR, OK } from 'http-status-codes';
import { Request as ExpReq, Response as ExpRes } from 'express';
import { logger } from "../logger";

import cors from 'cors';
import { Controller, Get, ClassMiddleware, Post } from "@overnightjs/core";

import AnchorService from '../services/anchor-service';

import type { Response } from "express-serve-static-core";
import { singleton } from "tsyringe";

@singleton()
@Controller('api/v0/anchors')
@ClassMiddleware([cors()])
export default class AnchorController {
  constructor(private anchorService: AnchorService) {}

  @Post()
  private async anchor(req: ExpReq, res: ExpRes): Promise<Response> {
    try {
      await this.anchorService.anchorRequests();

      return res.status(OK).json({
        message: 'anchored pending documents',
      });
    } catch (err) {
      const errmsg = `Anchoring pending documents failed: ${err.message}`
      logger.err(errmsg);
      return res.status(INTERNAL_SERVER_ERROR).json({
        error: errmsg,
      });
    }
  }
}
