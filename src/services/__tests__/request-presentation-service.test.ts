import { describe, expect, jest, test } from '@jest/globals'
import { RequestStatus } from '../../models/request.js'
import type { Config } from 'node-config-ts'
import { RequestPresentationService } from '../request-presentation-service.js'
import { generateRequest } from '../../__tests__/test-utils.js'
import type { AnchorRepository, AnchorWithRequest } from '../../repositories/anchor-repository.js'

const CONFIG = {
  schedulerIntervalMS: 1000,
} as unknown as Config

const anchorRepository = {
  findByRequest: jest.fn(),
} as unknown as AnchorRepository
const service = new RequestPresentationService(CONFIG, anchorRepository)

const REQUEST_OVERRIDE = {
  id: 889483296,
  cid: 'bafyreibfyl5p56xjdarie2p7brjmwktxgiggdm6hxyeugauk6zxg5c6g6m',
  streamId: 'k2t6wyfsu4pfxu08vo93w38oyu9itsuf374ekyeno0wb62ozm2o9sznrn8qp72',
  message: 'Fresh request',
  createdAt: new Date('2020-01-02T03:04Z'),
  updatedAt: new Date('2021-02-03T04:05Z'),
}

describe('present by RequestStatus', () => {
  test('PENDING, PROCESSING, FAILED, READY', async () => {
    const statuses = [
      RequestStatus.PENDING,
      RequestStatus.PROCESSING,
      RequestStatus.FAILED,
      RequestStatus.READY,
    ]
    for (const status of statuses) {
      const request = generateRequest({
        ...REQUEST_OVERRIDE,
        status: status,
      })
      const presentation = await service.body(request)
      expect(presentation).toMatchSnapshot()
    }
  })

  test('COMPLETED', async () => {
    const request = generateRequest({
      ...REQUEST_OVERRIDE,
      status: RequestStatus.COMPLETED,
    })
    const findByRequestSpy = jest.spyOn(anchorRepository, 'findByRequest')
    const anchor = {
      path: '/some/path',
      cid: 'anchor-cid',
      proofCid: 'anchor-proof-cid',
    }
    findByRequestSpy.mockImplementationOnce(async () => {
      return { ...anchor, request: request } as AnchorWithRequest
    })
    const presentation = await service.body(request)
    expect(presentation).toMatchSnapshot()
  })

  test('COMPLETED but no associated anchor', async () => {
    const request = generateRequest({
      ...REQUEST_OVERRIDE,
      status: RequestStatus.COMPLETED,
    })
    const findByRequestSpy = jest.spyOn(anchorRepository, 'findByRequest')
    findByRequestSpy.mockImplementationOnce(async () => {
      return null
    })
    const presentation = await service.body(request)
    expect(presentation).toMatchSnapshot()
  })
})
