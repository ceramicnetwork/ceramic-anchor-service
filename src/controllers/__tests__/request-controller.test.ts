import { describe, expect, jest, test } from '@jest/globals'
import { createDbConnection } from '../../db-connection.js'
import { createInjector, Injector } from 'typed-inject'
import { config } from 'node-config-ts'
import { RequestController } from '../request-controller.js'
import { RequestPresentationService } from '../../services/request-presentation-service.js'
import { RequestRepository } from '../../repositories/request-repository.js'
import { StatusCodes } from 'http-status-codes'
import {
  MockCeramicService,
  MockIpfsService,
  randomCID,
  randomStreamID,
} from '../../__tests__/test-utils.js'
import type { Knex } from 'knex'
import { RequestStatus } from '../../models/request.js'
import { StreamID } from '@ceramicnetwork/streamid'
import type { IMetadataService } from '../../services/metadata-service.js'
import { mockRequest, mockResponse } from './mock-request.util.js'
import { GenesisFields } from '../../models/metadata'
import { bases } from 'multiformats/basics'
import { toCID } from '@ceramicnetwork/common'
import { asDIDString } from '../../ancillary/did-string'
import * as uint8arrays from 'uint8arrays'

type Tokens = {
  requestController: RequestController
  requestRepository: RequestRepository
  metadataService: IMetadataService
}

const FAKE_STREAM_ID_1 = StreamID.fromString(
  'kjzl6hvfrbw6c5btpw2il5tino080437i2he8i8nqps9mudpik7qppl1or0jisn'
)
const FAKE_STREAM_ID_2 = StreamID.fromString(
  'k2t6wyfsu4pfy0gyeuovb1trrwhpqiko7ovwn96z05ojbqqo8n4ed4rd2bjez1'
)
const FAKE_TIP = toCID('bagcqcerabssdaiiphihqlu5fsxl34h7nyu3bn3ss3ejilp6idgc7ipyn6htq')
const FAKE_TIMESTAMP = new Date('2023-01-24T14:52:39.773Z')
const FAKE_GENESIS_FIELDS: GenesisFields = {
  controllers: [asDIDString('did:key:z6Mkwb5HHXyf2pxvq7NU4uePXHmRYNZDEbV4WWQZw3NMdybA')],
  model: uint8arrays.fromString('zgEEAXFxCwAJaG1vZGVsLXYx', 'base64'),
}

class MockMetadataService implements IMetadataService {
  async fill(streamId: StreamID, genesisFields: GenesisFields): Promise<void> {
    return
  }

  async fillFromIpfs(streamId: StreamID): Promise<void> {
    return
  }
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
      .provideClass('metadataService', MockMetadataService)
      .provideClass('requestController', RequestController)
    controller = container.resolve('requestController')
  })

  afterAll(async () => {
    await dbConnection.destroy()
  })

  describe('fresh request', () => {
    test('cid is empty', async () => {
      const req = mockRequest({
        headers: {
          'Content-type': 'application/json'
        },
      })
      const res = mockResponse()
      await controller.createRequest(req, res)
      expect(res.status).toBeCalledWith(StatusCodes.BAD_REQUEST)
      expect(res.json).toBeCalledWith({
        error: 'CID is empty',
      })
    })

    test('streamId is empty', async () => {
      const req = mockRequest({
        headers: {
          'Content-type': 'application/json'
        },
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
        headers: {
          'Content-type': 'application/json'
        },
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
        headers: {
          'Content-type': 'application/json'
        },
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

    test('create request with application/json', async () => {
      const cid = randomCID()
      const streamId = randomStreamID()
      const timestamp = new Date()
      const origin = '203.0.113.195'
      const req = mockRequest({
        headers: {
          'Content-type': 'application/json',
          'X-Forwarded-For': [` ${origin}`, `${origin}, 2001:db8:85a3:8d3:1319:8a2e:370:7348`],
        },
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
      expect(createdRequest.timestamp.valueOf()).toEqual(timestamp.valueOf())
      expect(createdRequest.createdAt.valueOf()).toBeCloseTo(now.valueOf(), -1.4) // within ~12 ms
      expect(createdRequest.updatedAt.valueOf()).toBeCloseTo(now.valueOf(), -1.4) // within ~12 ms
      expect(createdRequest.origin).toEqual(origin)
    })

    test('create request with application/vnd.ipld.car', async () => {
      const origin = '203.0.113.195'
      const req = mockRequest({
        headers: {
          'Content-type': 'application/vnd.ipld.car',
          'X-Forwarded-For': [` ${origin}`, `${origin}, 2001:db8:85a3:8d3:1319:8a2e:370:7348`],
        },
        body: bases["base64url"].decode("uOqJlcm9vdHOB2CpYJQABcRIgqJSnDGGAC9QO5fluDOzvwsMgfiefz-crDlW4FK3PdAtndmVyc2lvbgGnAQFxEiColKcMYYAL1A7l-W4M7O_CwyB-J5_P5ysOVbgUrc90C6NjdGlwWCUBhQESIAykMCEPOg8F06WV174f7cU2Fu5S2RKFv8gZhfQ_DfHnaHN0cmVhbUlkWCjOAQIBhQESIAykMCEPOg8F06WV174f7cU2Fu5S2RKFv8gZhfQ_DfHnaXRpbWVzdGFtcHgYMjAyMy0wMS0yNFQxNDo1MjozOS43NzNaugIBhQESIAykMCEPOg8F06WV174f7cU2Fu5S2RKFv8gZhfQ_DfHnomdwYXlsb2FkWCQBcRIgKUl41INh3f94akTEnGil-GM7X9txIueMaQ_TtVsmEctqc2lnbmF0dXJlc4GiaXByb3RlY3RlZFiBeyJhbGciOiJFZERTQSIsImtpZCI6ImRpZDprZXk6ejZNa3diNUhIWHlmMnB4dnE3TlU0dWVQWEhtUllOWkRFYlY0V1dRWnczTk1keWJBI3o2TWt3YjVISFh5ZjJweHZxN05VNHVlUFhIbVJZTlpERWJWNFdXUVp3M05NZHliQSJ9aXNpZ25hdHVyZVhAQPkqeTA-Haj9wNTVKDTAK4LDinqvLL9GGtevM-FUY5R9zdlYqq0c8pj3JaY15RJHhMuwqIEK1ZAnWmhEkjIxDLsFAXESIClJeNSDYd3_eGpExJxopfhjO1_bcSLnjGkP07VbJhHLomRkYXRhpmRuYW1lZ015TW9kZWxldmlld3OhaWxpbmtlZERvY6NkdHlwZXByZWxhdGlvbkRvY3VtZW50ZW1vZGVseD9ranpsNmh2ZnJidzZjNzg2Ymc5ZDhzeGx6ZXB3Z2N3dGVmdGN4YnpoaGp3YmRwaThxcnhhNHV0cDB4Y2VmbGxocHJvcGVydHlrbGlua2VkRG9jSURmc2NoZW1hpmR0eXBlZm9iamVjdGUkZGVmc6FvQ2VyYW1pY1N0cmVhbUlEo2R0eXBlZnN0cmluZ2V0aXRsZW9DZXJhbWljU3RyZWFtSURpbWF4TGVuZ3RoGGRnJHNjaGVtYXgsaHR0cHM6Ly9qc29uLXNjaGVtYS5vcmcvZHJhZnQvMjAyMC0xMi9zY2hlbWFocmVxdWlyZWSBa2xpbmtlZERvY0lEanByb3BlcnRpZXOha2xpbmtlZERvY0lEoWQkcmVmdyMvJGRlZnMvQ2VyYW1pY1N0cmVhbUlEdGFkZGl0aW9uYWxQcm9wZXJ0aWVz9GlyZWxhdGlvbnOha2xpbmtlZERvY0lEomR0eXBlaGRvY3VtZW50ZW1vZGVseD9ranpsNmh2ZnJidzZjNzg2Ymc5ZDhzeGx6ZXB3Z2N3dGVmdGN4YnpoaGp3YmRwaThxcnhhNHV0cDB4Y2VmbGxrZGVzY3JpcHRpb25wU21va2UgVGVzdCBNb2RlbG9hY2NvdW50UmVsYXRpb26hZHR5cGVkbGlzdGZoZWFkZXKiZW1vZGVsUs4BBAFxcQsACWhtb2RlbC12MWtjb250cm9sbGVyc4F4OGRpZDprZXk6ejZNa3diNUhIWHlmMnB4dnE3TlU0dWVQWEhtUllOWkRFYlY0V1dRWnczTk1keWJB"),
      })
      const res = mockResponse()
      const requestRepository = container.resolve('requestRepository')
      await expect(requestRepository.findByCid(FAKE_TIP)).resolves.toBeUndefined()
      const now = new Date()
      await controller.createRequest(req, res)

      expect(res.status).toBeCalledWith(StatusCodes.CREATED)
      const createdRequest = await requestRepository.findByCid(FAKE_TIP)
      expect(createdRequest).toBeDefined()
      expect(createdRequest.cid).toEqual(FAKE_TIP.toString())
      expect(createdRequest.status).toEqual(RequestStatus.PENDING)
      expect(createdRequest.streamId).toEqual(FAKE_STREAM_ID_1.toString())
      expect(createdRequest.message).toEqual('Request is pending.')
      expect(createdRequest.timestamp.valueOf()).toEqual(FAKE_TIMESTAMP.valueOf())
      expect(createdRequest.createdAt.valueOf()).toBeCloseTo(now.valueOf(), -1.4) // within ~12 ms
      expect(createdRequest.updatedAt.valueOf()).toBeCloseTo(now.valueOf(), -1.4) // within ~12 ms
      expect(createdRequest.origin).toEqual(origin)
    })

    test('timestamp is empty', async () => {
      const cid = randomCID()
      const streamId = randomStreamID()
      const now = new Date()
      const req = mockRequest({
        headers: {
          'Content-type': 'application/json'
        },
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
      expect(createdRequest.timestamp.valueOf()).toBeCloseTo(now.valueOf(), -1.4) // within ~12 ms
      expect(createdRequest.createdAt.valueOf()).toBeCloseTo(now.valueOf(), -1.4) // within ~12 ms
      expect(createdRequest.updatedAt.valueOf()).toBeCloseTo(now.valueOf(), -1.4) // within ~12 ms
      expect(createdRequest.origin).not.toBeNull()
    })

    test('fill metadata from IPFS', async () => {
      const cid = randomCID()
      const streamId = randomStreamID()
      const req = mockRequest({
        headers: {
          'Content-type': 'application/json'
        },
        body: {
          cid: cid.toString(),
          streamId: streamId.toString(),
        },
      })
      const metadataService = container.resolve('metadataService')
      const fillSpy = jest.spyOn(metadataService, 'fillFromIpfs')
      await controller.createRequest(req, mockResponse())
      expect(fillSpy).toBeCalledWith(streamId)
    })

    test('fill metadata from CAR file', async () => {
      const req = mockRequest({
        headers: {
          'Content-Type': 'application/vnd.ipld.car',
        },
        body: bases['base64url'].decode(
          'uOqJlcm9vdHOB2CpYJQABcRIgTxVu9Jjv6SAwCUb0CsL6nf_9pAvjegKTLUpDL5dUcktndmVyc2lvbgGNAQFxEiA1MeTiPctUallHEHAFRk8WdVu7f3U-9Uh5oUt7rzmVjaFmaGVhZGVyomVtb2RlbFLOAQQBcXELAAlobW9kZWwtdjFrY29udHJvbGxlcnOBeDhkaWQ6a2V5Ono2TWt3YjVISFh5ZjJweHZxN05VNHVlUFhIbVJZTlpERWJWNFdXUVp3M05NZHliQaUBAXESIE8VbvSY7-kgMAlG9ArC-p3__aQL43oCky1KQy-XVHJLo2N0aXBYJAFxEiA1MeTiPctUallHEHAFRk8WdVu7f3U-9Uh5oUt7rzmVjWhzdHJlYW1JZFgnzgEAAXESIDUx5OI9y1RqWUcQcAVGTxZ1W7t_dT71SHmhS3uvOZWNaXRpbWVzdGFtcHgYMjAyMy0wMS0yNFQxNDo1MjozOS43NzNa'
        ),
      })
      const metadataService = container.resolve('metadataService')
      const fillSpy = jest.spyOn(metadataService, 'fill')
      await controller.createRequest(req, mockResponse())
      expect(fillSpy).toBeCalledWith(FAKE_STREAM_ID_2, FAKE_GENESIS_FIELDS)
    })
  })

  describe('existing request', () => {
    test('return representation', async () => {
      // 0. Prepare
      const cid = randomCID()
      const streamId = randomStreamID()
      const now = new Date()
      const req = mockRequest({
        headers: {
          'Content-type': 'application/json'
        },
        body: {
          cid: cid.toString(),
          streamId: streamId.toString(),
          timestamp: now.toISOString(),
        },
      })
      const res = mockResponse()
      await controller.createRequest(req, res)
      const jsonFn = jest.spyOn(res, 'json')
      const presentation0 = jsonFn.mock.lastCall[0]

      // 1. Request existing request
      const res1 = mockResponse()
      await controller.createRequest(req, res1)
      const jsonFn1 = jest.spyOn(res1, 'json')
      const presentation1 = jsonFn1.mock.lastCall[0]
      expect(presentation1).toEqual(presentation0)
    })
  })
})
