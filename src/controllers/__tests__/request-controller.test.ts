import { describe, expect, jest, test } from '@jest/globals'
import { createDbConnection } from '../../db-connection.js'
import { createInjector, Injector } from 'typed-inject'
import { config } from 'node-config-ts'
import { RequestController } from '../request-controller.js'
import { RequestPresentationService } from '../../services/request-presentation-service.js'
import { RequestRepository } from '../../repositories/request-repository.js'
import type { Request as ExpReq, Response as ExpRes } from 'express'
import { StatusCodes } from 'http-status-codes'
import {
  MockCeramicService,
  MockIpfsService,
  randomCID,
  randomStreamID,
} from '../../__tests__/test-utils.js'
import type { Knex } from 'knex'
import merge from 'merge-options'
import { RequestStatus } from '../../models/request.js'

function mockResponse(): ExpRes {
  const res: any = {}
  res.status = jest.fn(() => res)
  res.json = jest.fn(() => res)
  res.send = jest.fn(() => res)
  return res as ExpRes
}

function mockRequest(input: any = {}): ExpReq {
  const defaults = {
    body: {},
  }
  return merge(defaults, input) as ExpReq
}

type Tokens = {
  requestController: RequestController
  requestRepository: RequestRepository
}

describe('createRequest', () => {
  let dbConnection: Knex
  let container: Injector<Tokens>
  let controller: RequestController

  beforeAll(async () => {
    dbConnection = await createDbConnection()
    container = createInjector()
      .provideValue('config', config)
      .provideValue('dbConnection', dbConnection)
      .provideClass('requestRepository', RequestRepository)
      .provideClass('anchorRepository', RequestRepository)
      .provideClass('ipfsService', MockIpfsService)
      .provideClass('ceramicService', MockCeramicService)
      .provideClass('requestPresentationService', RequestPresentationService)
      .provideClass('requestController', RequestController)
    controller = container.resolve('requestController')
  })

  afterAll(async () => {
    await dbConnection.destroy()
  })

  describe('fresh request', () => {
    test('cid is empty', async () => {
      const req = mockRequest()
      const res = mockResponse()
      await controller.createRequest(req, res)
      expect(res.status).toBeCalledWith(StatusCodes.BAD_REQUEST)
      expect(res.json).toBeCalledWith({
        error: 'CID is empty',
      })
    })
    test('streamId is empty', async () => {
      const req = mockRequest({
        body: {
          cid: randomCID().toString(),
        },
      })
      const res = mockResponse()
      await controller.createRequest(req, res)
      expect(res.status).toBeCalledWith(StatusCodes.BAD_REQUEST)
      expect(res.json).toBeCalledWith({
        error: 'Stream ID is empty',
      })
    })
    test('cid is malformed', async () => {
      const streamId = randomStreamID()
      const req = mockRequest({
        body: {
          cid: 'garbage',
          streamId: streamId.toString(),
        },
      })
      const res = mockResponse()
      await controller.createRequest(req, res)
      expect(res.status).toBeCalledWith(StatusCodes.BAD_REQUEST)
      const jsonFn = jest.spyOn(res, 'json')
      expect(jsonFn.mock.calls[0][0].error).toMatch(
        `Creating request with streamId ${req.body.streamId} and commit CID ${req.body.cid} failed`
      )
    })
    test('streamId is malformed', async () => {
      const req = mockRequest({
        body: {
          cid: randomCID().toString(),
          streamId: 'garbage',
        },
      })
      const res = mockResponse()
      await controller.createRequest(req, res)
      expect(res.status).toBeCalledWith(StatusCodes.BAD_REQUEST)
      const jsonFn = jest.spyOn(res, 'json')
      expect(jsonFn.mock.calls[0][0].error).toMatch(
        `Creating request with streamId ${req.body.streamId} and commit CID ${req.body.cid} failed`
      )
    })

    test('create request', async () => {
      const cid = randomCID()
      const streamId = randomStreamID()
      const timestamp = new Date()
      const req = mockRequest({
        body: {
          cid: cid.toString(),
          streamId: streamId.toString(),
          timestamp: timestamp.toISOString(),
        },
      })
      const res = mockResponse()
      const requestRepository = container.resolve('requestRepository')
      await expect(requestRepository.findByCid(cid)).resolves.toBeUndefined()
      const now = new Date()
      await controller.createRequest(req, res)
      expect(res.status).toBeCalledWith(StatusCodes.CREATED)
      const createdRequest = await requestRepository.findByCid(cid)
      expect(createdRequest).toBeDefined()
      expect(createdRequest.cid).toEqual(cid.toString())
      expect(createdRequest.status).toEqual(RequestStatus.PENDING)
      expect(createdRequest.streamId).toEqual(streamId.toString())
      expect(createdRequest.message).toEqual('Request is pending.')
      // FIXME Timezones
      // expect(createdRequest.timestamp.valueOf()).toEqual(timestamp.valueOf())
      // expect(createdRequest.createdAt.valueOf()).toBeCloseTo(now.valueOf(), -1.4) // within ~12 ms
      // expect(createdRequest.updatedAt.valueOf()).toBeCloseTo(now.valueOf(), -1.4) // within ~12 ms
      // expect(createdRequest.origin).toBeNull()
    })

    test('timestamp is empty', async () => {
      const cid = randomCID()
      const streamId = randomStreamID()
      const now = new Date()
      const req = mockRequest({
        body: {
          cid: cid.toString(),
          streamId: streamId.toString(),
        },
      })
      const res = mockResponse()
      const requestRepository = container.resolve('requestRepository')
      await expect(requestRepository.findByCid(cid)).resolves.toBeUndefined()
      await controller.createRequest(req, res)
      expect(res.status).toBeCalledWith(StatusCodes.CREATED)
      const createdRequest = await requestRepository.findByCid(cid)
      expect(createdRequest).toBeDefined()
      expect(createdRequest.cid).toEqual(cid.toString())
      expect(createdRequest.status).toEqual(RequestStatus.PENDING)
      expect(createdRequest.streamId).toEqual(streamId.toString())
      expect(createdRequest.message).toEqual('Request is pending.')
      // FIXME Timezones
      // expect(createdRequest.timestamp.valueOf()).toBeCloseTo(now.valueOf(), -1.4) // within ~12 ms
      // expect(createdRequest.createdAt.valueOf()).toBeCloseTo(now.valueOf(), -1.4) // within ~12 ms
      // expect(createdRequest.updatedAt.valueOf()).toBeCloseTo(now.valueOf(), -1.4) // within ~12 ms
      // expect(createdRequest.origin).toBeNull()
    })
  })
  test.todo('existing request')
})
