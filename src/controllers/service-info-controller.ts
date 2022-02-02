import httpStatusCodes from 'http-status-codes'
import { Request as ExpReq, Response as ExpRes } from 'express'
import cors from 'cors'
import { ClassMiddleware, Controller, Get } from '@overnightjs/core'
import { logger } from '../logger/index.js'
import { BlockchainService } from '../services/blockchain/blockchain-service.js'
import { inject, singleton } from 'tsyringe'

const { OK, SERVICE_UNAVAILABLE } = httpStatusCodes

/**
 * The ServiceInfoController class defines an API endpoint for requests for information about the
 * CeramicAnchorService itself.
 */
@singleton()
@Controller('api/v0/service-info')
@ClassMiddleware([cors()])
export class ServiceInfoController {
  constructor(@inject('blockchainService') private blockchainService?: BlockchainService) {}

  @Get('supported_chains')
  private async getSupportedChains(req: ExpReq, res: ExpRes): Promise<ExpRes<any>> {
    try {
      return res.status(OK).json({ supportedChains: [this.blockchainService.chainId] })
    } catch (err) {
      logger.err(`Loading supported chainIds from configured blockchain failed: ${err.message()}`)
      return res.status(SERVICE_UNAVAILABLE).send()
    }
  }
}
