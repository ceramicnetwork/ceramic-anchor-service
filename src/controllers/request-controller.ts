import { OK, NOT_FOUND, BAD_REQUEST, CREATED } from "http-status-codes";
import { Request as ExpReq, Response as ExpRes } from 'express';
import { Logger, Logger as logger } from '@overnightjs/logger';

import cors from 'cors';
import { Controller, Get, Post, ClassMiddleware } from '@overnightjs/core';

import CID from 'cids';
import Context from '../context';
import RequestService from '../services/request-service';
import Contextual from '../contextual';
import { RequestStatus } from '../models/request-status';
import AnchorService from '../services/anchor-service';
import { Anchor } from '../models/anchor';

@Controller('api/v0/requests')
@ClassMiddleware([cors()])
export default class RequestController implements Contextual {
  private anchorService: AnchorService;
  private requestService: RequestService;

  setContext(context: Context): void {
    this.anchorService = context.lookup('AnchorService');
    this.requestService = context.lookup('RequestService');
  }

  @Get(':id')
  private async get(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    logger.Info(req.params.id);

    try {
      const request = await this.requestService.findById(req.params.id);
      if (request == null) {
        return res.status(NOT_FOUND).send({
          error: 'Request doesn\'t exist',
        });
      }

      if (RequestStatus.COMPLETED === request.status) {
        const anchor: Anchor = await this.anchorService.findByRequest(request);

        return res.status(OK).json({
          id: request.id,
          status: request.status,
          cid: request.cid,
          docId: request.docId,
          createdAt: request.createdAt,
          updatedAt: request.updatedAt,
          anchorMetadata: RequestController.convertToAnchorMetadata(anchor),
        });
      }

      return res.status(OK).json(request);
    } catch (err) {
      Logger.Err(err, true);
      return res.status(BAD_REQUEST).json({
        error: err.message,
      });
    }
  }

  /**
   * Converts to IPFS anchor metadata structure
   * @param anchor - Anchor record
   */
  private static convertToAnchorMetadata(anchor: Anchor): any {
    return {
      cid: anchor.cid,
      prev: anchor.request.cid,
      proof: {
        blockNumber: anchor.blockNumber,
        blockTimestamp: anchor.blockTimestamp,
        root: anchor.proof,
        chainId: anchor.chain,
        txHash: anchor.txHashCid,
      },
      path: anchor.path,
    };
  }

  @Post()
  private async create(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    try {
      logger.Info(req.body, true);

      const { cid, docId } = req.body;

      const cidObj = new CID(cid);
      const request = await this.requestService.findByCid(cidObj);
      if (request != null) {
        return res.status(BAD_REQUEST).send('CID has already been submitted');
      }

      const created = await this.requestService.create(cid, docId);
      return res.status(OK).json(created);
    } catch (err) {
      Logger.Err(err, true);
      return res.status(CREATED).json({
        error: err.message,
      });
    }
  }
}
