import { BAD_REQUEST, OK } from 'http-status-codes';
import { Request as ExpReq, Response as ExpRes } from 'express';
import { Logger, Logger as logger } from '@overnightjs/logger';

import { v4 as uuid } from 'uuid';

import cors from 'cors';
import { Controller, Get, ClassMiddleware } from '@overnightjs/core';

import Context from '../context';
import AnchorService from '../services/anchor-service';
import Contextual from '../contextual';
import RequestService from '../services/request-service';

import { Ipfs } from 'ipfs';
import ipfsClient from 'ipfs-http-client';

import { config } from 'node-config-ts';
import type { Response } from "express-serve-static-core";
import { Request } from "../models/request";
import { RequestStatus } from "../models/request-status";

@Controller('api/v0/internal')
@ClassMiddleware([cors()])
export default class InternalController implements Contextual {
  private anchorService: AnchorService;
  private requestService: RequestService;
  private ipfs: Ipfs;

  constructor() {
    this.ipfs = ipfsClient(config.ipfsConfig.host);
  }

  /**
   * Set application context
   * @param context - app context
   */
  setContext(context: Context): void {
    this.anchorService = context.lookup('AnchorService');
    this.requestService = context.lookup('RequestService');
  }

  @Get(':number')
  private async create(req: ExpReq, res: ExpRes): Promise<Response> {
    try {
      logger.Imp(`Create ${req.params.number} updates`);

      const requests: Request[] = [];
      for (let i = 0; i < +req.params.number; i++) {
        const cid = await this.ipfs.dag.put({
          someField: 'some_value_' + uuid(),
        });

        const docId = 'some_doc_' + uuid();

        const request: Request = new Request();
        request.cid = cid.toString();
        request.docId = docId;
        request.status = RequestStatus.PENDING;
        request.message = 'Request is pending.';

        requests.push(request);
      }

      await this.requestService.insert(requests);

      return res.status(OK).json({
        message: `generated ${req.params.number} updates`,
      });
    } catch (err) {
      Logger.Err(err, true);
      return res.status(BAD_REQUEST).json({
        error: err.message,
      });
    }
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
