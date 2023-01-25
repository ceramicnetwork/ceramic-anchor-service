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

type Tokens = {
  requestController: RequestController
  requestRepository: RequestRepository
  metadataService: IMetadataService
}

const FAKE_STREAM_ID_1 = StreamID.fromString(
  'k2t6wzhkhabz5h9xxyrc6qoh1mcj6b0ul90xxkoin4t5bns89e3vh0gyyy1exj'
)
const FAKE_STREAM_ID_2 = StreamID.fromString(
  'k2t6wyfsu4pg1tpfbjf20op9tmfofulf9tyiyvc2wueupetzrcnp8r4wmnhw47'
)
const FAKE_TIP = toCID('bagcqceransp4tpxraev7xfqz5b2kxsj37pffwt2ahh2hfzt4uegvtzc64cja')
const FAKE_TIMESTAMP = new Date('2023-01-25T17:32:42.971Z')
const FAKE_GENESIS_FIELDS: GenesisFields = {
  controllers: [asDIDString('did:pkh:eip155:1:0x926eeb192c18b7be607a7e10c8e7a7e8d9f70742')],
  model: bases['base64'].decode("mzgECAYUBEiCIsWIw6kon5HSV8g+usyjT1ohr++q6zx+OOGy/05bUjQ"),
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
        body: bases["base64url"].decode("uOqJlcm9vdHOB2CpYJQABcRIgT3FJQeLnnsO6MIl-uaKoEEMtWOoRWLryBIeDtpDEfLVndmVyc2lvbgGpAQFxEiBPcUlB4ueew7owiX65oqgQQy1Y6hFYuvIEh4O2kMR8taNjdGlw2CpYJgABhQESIGyfyb7xASv7lhnodKvJO_vKW09AOfRy5nyhDVnkXuCSaHN0cmVhbUlkWCfOAQMBcRIgziTbUSGEnXjdjPt90kN--q4Z4KTF--6RBDWym0xKS9dpdGltZXN0YW1weBgyMDIzLTAxLTI1VDE3OjMyOjQyLjk3MVqtAQFxEiDOJNtRIYSdeN2M-33SQ376rhngpMX77pEENbKbTEpL16JkZGF0YfZmaGVhZGVyomVtb2RlbFgozgECAYUBEiCIsWIw6kon5HSV8g-usyjT1ohr--q6zx-OOGy_05bUjWtjb250cm9sbGVyc4F4O2RpZDpwa2g6ZWlwMTU1OjE6MHg5MjZlZWIxOTJjMThiN2JlNjA3YTdlMTBjOGU3YTdlOGQ5ZjcwNzQyhQMBhQESIGyfyb7xASv7lhnodKvJO_vKW09AOfRy5nyhDVnkXuCSomdwYXlsb2FkWCQBcRIgZb5XVvi4dxmi46nuSsIRqbFQ-4zYXUiL_Eyu7vQETXtqc2lnbmF0dXJlc4GiaXByb3RlY3RlZFjMeyJhbGciOiJFZERTQSIsImNhcCI6ImlwZnM6Ly9iYWZ5cmVpYWRwcnA2cG5wdDU3bXI2bHlzZ2xrdHFjaWtyaDRmbTN2bm1sb2I0dzQybnNuaHNjeGVndSIsImtpZCI6ImRpZDprZXk6ejZNa2tVM1VIb0JtUlY5ZXozOFplcmtRUFoyV3lNRFFSb1BrM2lZcGp0V0pLQ0RZI3o2TWtrVTNVSG9CbVJWOWV6MzhaZXJrUVBaMld5TURRUm9QazNpWXBqdFdKS0NEWSJ9aXNpZ25hdHVyZVhA9F3nGf-Hp3j81dIMI-Af_Xbp9eiRGE2e1O68t17eK-JBRPneTAwbt_Z1Nsc6IhssYfZBD1fI7HuCV4Oj5p-iAoUCAXESIGW-V1b4uHcZouOp7krCEamxUPuM2F1Ii_xMru70BE17o2JpZNgqWCUAAXESIM4k21EhhJ143Yz7fdJDfvquGeCkxfvukQQ1sptMSkvXZGRhdGGEo2JvcGNhZGRkcGF0aGUvbmFtZWV2YWx1ZWVBcnR1cqNib3BjYWRkZHBhdGhmL2Vtb2ppZXZhbHVlYjopo2JvcGNhZGRkcGF0aGcvZ2VuZGVyZXZhbHVlZE1hbGWjYm9wY2FkZGRwYXRobC9kZXNjcmlwdGlvbmV2YWx1ZWNEZXZkcHJldtgqWCUAAXESIM4k21EhhJ143Yz7fdJDfvquGeCkxfvukQQ1sptMSkvXjwQBcRIgA3xf57Xz79kfLxIy1TgJCon4Vm6tYtweW5psmnkK5DWjYWihYXRnZWlwNDM2MWFwqWNhdWR4OGRpZDprZXk6ejZNa2tVM1VIb0JtUlY5ZXozOFplcmtRUFoyV3lNRFFSb1BrM2lZcGp0V0pLQ0RZY2V4cHgYMjAyMy0wMS0yNlQxNzowNToyNS44MDlaY2lhdHgYMjAyMy0wMS0yNVQxNzowNToyNS44MDlaY2lzc3g7ZGlkOnBraDplaXAxNTU6MToweDkyNmVlYjE5MmMxOGI3YmU2MDdhN2UxMGM4ZTdhN2U4ZDlmNzA3NDJlbm9uY2VqcUhyWGthckFrU2Zkb21haW5pbG9jYWxob3N0Z3ZlcnNpb25hMWlyZXNvdXJjZXOBa2NlcmFtaWM6Ly8qaXN0YXRlbWVudHg8R2l2ZSB0aGlzIGFwcGxpY2F0aW9uIGFjY2VzcyB0byBzb21lIG9mIHlvdXIgZGF0YSBvbiBDZXJhbWljYXOiYXN4hDB4ZjU0YmI4OTk1NGIyODE3MzBjMzBmNTdjNzBiMzcxODNiZTBiNzEwMWUxNTEwMThiZTNmYmIzZTg4Y2RhM2Y1MDZhZGVjNGI5YzBmZjJlZDUwYmI5ODM0NWQ1N2ZjNmZiMWEwY2FlNjRlMWE1MzlhYzNmMzU3MDA3YzllMTc1YzYxYmF0ZmVpcDE5MQ"),
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
          'uOqJlcm9vdHOB2CpYJQABcRIgax-ozdCQvEUBpYyAxxvdm2oCT9Ybk_a8N3W28qhEkOlndmVyc2lvbgGtAQFxEiDOJNtRIYSdeN2M-33SQ376rhngpMX77pEENbKbTEpL16JkZGF0YfZmaGVhZGVyomVtb2RlbFgozgECAYUBEiCIsWIw6kon5HSV8g-usyjT1ohr--q6zx-OOGy_05bUjWtjb250cm9sbGVyc4F4O2RpZDpwa2g6ZWlwMTU1OjE6MHg5MjZlZWIxOTJjMThiN2JlNjA3YTdlMTBjOGU3YTdlOGQ5ZjcwNzQyqAEBcRIgax-ozdCQvEUBpYyAxxvdm2oCT9Ybk_a8N3W28qhEkOmjY3RpcNgqWCUAAXESIM4k21EhhJ143Yz7fdJDfvquGeCkxfvukQQ1sptMSkvXaHN0cmVhbUlkWCfOAQABcRIgziTbUSGEnXjdjPt90kN--q4Z4KTF--6RBDWym0xKS9dpdGltZXN0YW1weBgyMDIzLTAxLTI1VDE3OjMyOjQyLjk3MVo'
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
