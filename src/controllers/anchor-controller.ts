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

@Controller('api/v0/anchors')
@ClassMiddleware([cors()])
export default class AnchorController implements Contextual {
  private anchorService: AnchorService;
  private requestService: RequestService;
  private ipfs: Ipfs;

  constructor() {
    this.ipfs = ipfsClient(config.ipfsConfig.host);
  }

  setContext(context: Context): void {
    this.anchorService = context.lookup('AnchorService');
    this.requestService = context.lookup('RequestService');
  }

  @Get(':number') // TODO - remove TESTING PURPOSES ONLY
  private async anchor(req: ExpReq, res: ExpRes) {
    try {
      logger.Imp('Create ' + req.params.number + ' CIDs and anchor them to blockchain');

      for (let i = 0; i < +req.params.number; i++) {
        const cid = await this.ipfs.dag.put({
          test: 'test_' + uuid() + i,
        });

        const docId = 'doc_1' + uuid();
        await this.requestService.create(cid.string, docId);
      }

      await this.anchorService.anchorRequests();

      return res.status(OK).json({
        message: 'generated and anchored',
      });
    } catch (err) {
      Logger.Err(err, true);
      return res.status(BAD_REQUEST).json({
        error: err.message,
      });
    }
  }
}
