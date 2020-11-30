import { BAD_REQUEST, CREATED, NOT_FOUND, OK } from 'http-status-codes';
import { Request as ExpReq, Response as ExpRes } from 'express';
import { Logger, Logger as logger } from '@overnightjs/logger';

import parser from 'cron-parser';
import { config } from 'node-config-ts';

import cors from 'cors';
import { ClassMiddleware, Controller, Get, Post } from '@overnightjs/core';

import CID from 'cids';
import RequestService from '../services/request-service';
import { RequestStatus } from '../models/request-status';
import AnchorService from '../services/anchor-service';
import { Anchor } from '../models/anchor';
import { Request } from "../models/request";
import { inject, singleton } from "tsyringe";

@singleton()
@Controller('api/v0/requests')
@ClassMiddleware([cors()])
export default class RequestController {

  constructor(@inject('anchorService') private anchorService?: AnchorService,
              @inject('requestService') private requestService?: RequestService, ) {
  }

  @Get(':cid')
  private async getStatusForCid(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    logger.Info(`Get info for ${req.params.cid}`);

    try {
      const cid = new CID(req.params.cid);
      if (cid == null) {
        return res.status(BAD_REQUEST).send({
          error: 'CID is empty',
        });
      }

      const request = await this.requestService.findByCid(cid);
      if (request == null) {
        return res.status(NOT_FOUND).send({
          error: "Request doesn't exist",
        });
      }

      switch (request.status) {
        case RequestStatus.COMPLETED: {
          const anchor: Anchor = await this.anchorService.findByRequest(request);

          return res.status(OK).json({
            id: request.id,
            status: RequestStatus[request.status],
            cid: request.cid,
            docId: request.docId,
            message: request.message,
            createdAt: request.createdAt.getTime(),
            updatedAt: request.updatedAt.getTime(),
            anchorRecord: {
              cid: anchor.cid,
              content: {
                path: anchor.path,
                prev: anchor.request.cid,
                proof: anchor.proofCid,
              },
            },
          });
        }
        case RequestStatus.PENDING: {
          const interval = parser.parseExpression(config.cronExpression);

          return res.status(OK).json({
            id: request.id,
            status: RequestStatus[request.status],
            cid: request.cid,
            docId: request.docId,
            message: request.message,
            createdAt: request.createdAt.getTime(),
            updatedAt: request.updatedAt.getTime(),
            scheduledAt: interval.next().toDate().getTime(),
          });
        }
        case RequestStatus.PROCESSING:
          return res.status(OK).json({
            id: request.id,
            status: RequestStatus[request.status],
            cid: request.cid,
            docId: request.docId,
            message: request.message,
            createdAt: request.createdAt.getTime(),
            updatedAt: request.updatedAt.getTime(),
          });
        case RequestStatus.FAILED:
          return res.status(OK).json({
            id: request.id,
            status: RequestStatus[request.status],
            cid: request.cid,
            docId: request.docId,
            message: request.message,
            createdAt: request.createdAt.getTime(),
            updatedAt: request.updatedAt.getTime(),
          });
      }
    } catch (err) {
      Logger.Err(err, true);
      return res.status(BAD_REQUEST).json({
        error: err.message,
      });
    }
  }

  @Post()
  private async createRequest(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    try {
      logger.Info(`Create request ${JSON.stringify(req.body)}`);

      const { cid, docId } = req.body;

      if (cid == null) {
        return res.status(BAD_REQUEST).send({
          error: 'CID is empty',
        });
      }

      if (docId == null) {
        return res.status(BAD_REQUEST).send({
          error: 'Document ID is empty',
        });
      }

      const cidObj = new CID(cid);
      let request: Request = await this.requestService.findByCid(cidObj);
      if (request != null) {
        return res.status(BAD_REQUEST).send('CID has already been submitted');
      }

      request = new Request();
      request.cid = cid.toString();
      request.docId = docId;
      request.status = RequestStatus.PENDING;
      request.message = 'Request is pending.';

      request = await this.requestService.createOrUpdate(request);
      const interval = parser.parseExpression(config.cronExpression);

      return res.status(CREATED).json({
        id: request.id,
        status: RequestStatus[request.status],
        cid: request.cid,
        docId: request.docId,
        message: request.message,
        createdAt: request.createdAt.getTime(),
        updatedAt: request.updatedAt.getTime(),
        scheduledAt: interval.next().toDate().getTime(),
      });
    } catch (err) {
      Logger.Err(err, true);
      return res.status(BAD_REQUEST).json({
        error: err.message,
      });
    }
  }
}
