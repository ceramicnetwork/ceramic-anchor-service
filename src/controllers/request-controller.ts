import { BAD_REQUEST, CREATED, NOT_FOUND, OK } from 'http-status-codes';
import { Request as ExpReq, Response as ExpRes } from 'express';

import { config } from 'node-config-ts';
import awsCronParser from "aws-cron-parser";

import cors from 'cors';
import { ClassMiddleware, Controller, Get, Post } from '@overnightjs/core';

import CID from 'cids';
import { RequestStatus } from '../models/request-status';
import AnchorRepository from "../repositories/anchor-repository";
import RequestRepository from '../repositories/request-repository';
import { Anchor } from '../models/anchor';
import { Request } from "../models/request";
import { inject, singleton } from "tsyringe";
import { logger } from '../logger';

@singleton()
@Controller('api/v0/requests')
@ClassMiddleware([cors()])
export default class RequestController {

  constructor(@inject('anchorRepository') private anchorRepository?: AnchorRepository,
              @inject('requestRepository') private requestRepository?: RequestRepository, ) {
  }

  @Get(':cid')
  private async getStatusForCid(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    logger.debug(`Get info for ${req.params.cid}`);

    try {
      const cid = new CID(req.params.cid);
      if (cid == null) {
        return res.status(BAD_REQUEST).send({
          error: 'CID is empty',
        });
      }

      const request = await this.requestRepository.findByCid(cid);
      if (request == null) {
        return res.status(NOT_FOUND).send({
          error: `Request with cid ${cid.toString()} doesn't exist`,
        });
      }

      switch (request.status) {
        case RequestStatus.COMPLETED: {
          const anchor: Anchor = await this.anchorRepository.findByRequest(request);

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
          const cron = awsCronParser.parse(config.cronExpression);

          return res.status(OK).json({
            id: request.id,
            status: RequestStatus[request.status],
            cid: request.cid,
            docId: request.docId,
            message: request.message,
            createdAt: request.createdAt.getTime(),
            updatedAt: request.updatedAt.getTime(),
            scheduledAt: awsCronParser.next(cron, new Date()),
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
      const errmsg = `Loading request status for CID ${req.params.cid} failed: ${err.message}`
      logger.err(errmsg);
      return res.status(BAD_REQUEST).json({
        error: errmsg,
      });
    }
  }

  @Post()
  private async createRequest(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    try {
      logger.debug(`Create request ${JSON.stringify(req.body)}`);

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
      let request: Request = await this.requestRepository.findByCid(cidObj);
      if (request != null) {
        return res.status(BAD_REQUEST).send(`CID ${cidObj.toString()} has already been submitted`);
      }

      request = new Request();
      request.cid = cid.toString();
      request.docId = docId;
      request.status = RequestStatus.PENDING;
      request.message = 'Request is pending.';

      request = await this.requestRepository.createOrUpdate(request);

      const cron = awsCronParser.parse(config.cronExpression);

      return res.status(CREATED).json({
        id: request.id,
        status: RequestStatus[request.status],
        cid: request.cid,
        docId: request.docId,
        message: request.message,
        createdAt: request.createdAt.getTime(),
        updatedAt: request.updatedAt.getTime(),
        scheduledAt: awsCronParser.next(cron, new Date()),
      });
    } catch (err) {
      const errmsg = `Creating request with docId ${req.body.docId} and commit CID ${req.body.cid} failed: ${err.message}`
      logger.err(errmsg);
      return res.status(BAD_REQUEST).json({
        error: errmsg,
      });
    }
  }
}
