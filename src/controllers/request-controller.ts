import { StatusCodes } from 'http-status-codes';
import { Request as ExpReq, Response as ExpRes } from 'express';

import { config } from 'node-config-ts';
import awsCronParser from 'aws-cron-parser';

import cors from 'cors';
import { ClassMiddleware, Controller, Get, Post } from '@overnightjs/core';

import CID from 'cids';
import { RequestStatus } from '../models/request-status';
import AnchorRepository from '../repositories/anchor-repository';
import RequestRepository from '../repositories/request-repository';
import { Request } from '../models/request';
import { inject, singleton } from 'tsyringe';
import { logger } from '../logger';
import { RequestPresentation } from '../models/request-presentation';

@singleton()
@Controller('api/v0/requests')
@ClassMiddleware([cors()])
export default class RequestController {
  #requestPresentation: RequestPresentation;

  constructor(
    @inject('anchorRepository') private anchorRepository?: AnchorRepository,
    @inject('requestRepository') private requestRepository?: RequestRepository,
  ) {
    this.#requestPresentation = new RequestPresentation(config.cronExpression, anchorRepository);
  }

  @Get(':cid')
  private async getStatusForCid(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    logger.debug(`Get info for ${req.params.cid}`);

    try {
      const cid = new CID(req.params.cid);
      if (cid) {
        const request = await this.requestRepository.findByCid(cid);
        if (request) {
          const body = await this.#requestPresentation.body(request);
          return res.status(StatusCodes.OK).json(body);
        } else {
          return res.status(StatusCodes.NOT_FOUND).send({
            error: "Request doesn't exist",
          });
        }
      } else {
        return res.status(StatusCodes.BAD_REQUEST).send({
          error: 'CID is empty',
        });
      }
    } catch (err) {
      logger.err(err);
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: err.message,
      });
    }
  }

  @Post()
  private async createRequest(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    try {
      logger.debug(`Create request ${JSON.stringify(req.body)}`);

      const { cid, docId } = req.body;

      if (cid == null) {
        return res.status(StatusCodes.BAD_REQUEST).send({
          error: 'CID is empty',
        });
      }

      if (docId == null) {
        return res.status(StatusCodes.BAD_REQUEST).send({
          error: 'Document ID is empty',
        });
      }

      const cidObj = new CID(cid);
      let request = await this.requestRepository.findByCid(cidObj);
      if (request) {
        const body = await this.#requestPresentation.body(request);
        return res.status(StatusCodes.ACCEPTED).json(body);
      } else {
        request = new Request();
        request.cid = cid.toString();
        request.docId = docId;
        request.status = RequestStatus.PENDING;
        request.message = 'Request is pending.';

        request = await this.requestRepository.createOrUpdate(request);

        const cron = awsCronParser.parse(config.cronExpression);

        return res.status(StatusCodes.CREATED).json({
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
    } catch (err) {
      logger.err(err);
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: err.message,
      });
    }
  }
}
