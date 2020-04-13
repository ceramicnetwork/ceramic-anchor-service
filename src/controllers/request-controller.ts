import { BAD_REQUEST, CREATED, NOT_FOUND, OK } from 'http-status-codes';
import { Request as ExpReq, Response as ExpRes } from 'express';
import { Logger, Logger as logger } from '@overnightjs/logger';

import parser from 'cron-parser';
import { config } from 'node-config-ts';

import cors from 'cors';
import { ClassMiddleware, Controller, Get, Post } from '@overnightjs/core';

import CID from 'cids';
import Context from '../context';
import RequestService from '../services/request-service';
import Contextual from '../contextual';
import { RequestStatus } from '../models/request-status';
import AnchorService from '../services/anchor-service';
import { Anchor } from '../models/anchor';
import Utils from '../utils';

@Controller('api/v0/requests')
@ClassMiddleware([cors()])
export default class RequestController implements Contextual {
  private anchorService: AnchorService;
  private requestService: RequestService;

  setContext(context: Context): void {
    this.anchorService = context.lookup('AnchorService');
    this.requestService = context.lookup('RequestService');
  }

  @Get(':cid')
  private async get(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    logger.Info(req.params.cid);

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
            createdAt: Utils.convertToUnixTimestamp(request.createdAt),
            updatedAt: Utils.convertToUnixTimestamp(request.updatedAt),
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
            createdAt: Utils.convertToUnixTimestamp(request.createdAt),
            updatedAt: Utils.convertToUnixTimestamp(request.updatedAt),
            scheduledAt: Utils.convertToUnixTimestamp(interval.next().toDate()),
          });
        }
        case RequestStatus.PROCESSING:
          return res.status(OK).json({
            id: request.id,
            status: RequestStatus[request.status],
            cid: request.cid,
            docId: request.docId,
            message: request.message,
            createdAt: Utils.convertToUnixTimestamp(request.createdAt),
            updatedAt: Utils.convertToUnixTimestamp(request.updatedAt),
          });
        case RequestStatus.FAILED:
          return res.status(OK).json({
            id: request.id,
            status: RequestStatus[request.status],
            cid: request.cid,
            docId: request.docId,
            message: request.message,
            createdAt: Utils.convertToUnixTimestamp(request.createdAt),
            updatedAt: Utils.convertToUnixTimestamp(request.updatedAt),
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
  private async create(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    try {
      logger.Info(req.body, true);

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
      const request = await this.requestService.findByCid(cidObj);
      if (request != null) {
        return res.status(BAD_REQUEST).send('CID has already been submitted');
      }

      const created = await this.requestService.create(cid, docId);
      const interval = parser.parseExpression(config.cronExpression);

      return res.status(CREATED).json({
        id: created.id,
        status: RequestStatus[created.status],
        cid: created.cid,
        docId: created.docId,
        message: created.message,
        createdAt: Utils.convertToUnixTimestamp(created.createdAt),
        updatedAt: Utils.convertToUnixTimestamp(created.updatedAt),
        scheduledAt: Utils.convertToUnixTimestamp(interval.next().toDate()),
      });
    } catch (err) {
      Logger.Err(err, true);
      return res.status(BAD_REQUEST).json({
        error: err.message,
      });
    }
  }
}
