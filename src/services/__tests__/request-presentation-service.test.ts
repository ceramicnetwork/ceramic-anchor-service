import { describe, expect, jest, test } from '@jest/globals'
import { RequestStatus } from '../../models/request.js'
import {
  CompletedAnchorlessError,
  RequestPresentationService,
} from '../request-presentation-service.js'
import type {
  AnchorWithRequest,
  IAnchorRepository,
} from '../../repositories/anchor-repository.type.js'
import { generateRequest } from '../../__tests__/test-utils.js'
import { InMemoryMerkleCarService } from '../merkle-car-service.js'
import { WitnessService } from '../witness-service.js'
import { CID } from 'multiformats/cid'
import { CARFactory } from 'cartonne'
import { pathLine } from '../../ancillary/codecs.js'
import { PathDirection } from '@ceramicnetwork/anchor-utils'

const carFactory = new CARFactory()

const anchorRepository = {
  findByRequest: jest.fn(),
} as unknown as IAnchorRepository
const merkleCarService = new InMemoryMerkleCarService()
const witnessService = new WitnessService()

const service = new RequestPresentationService(anchorRepository, merkleCarService, witnessService)

const FAKE_CID = CID.parse('bafyreibfyl5p56xjdarie2p7brjmwktxgiggdm6hxyeugauk6zxg5c6g6m')

const REQUEST_OVERRIDE = {
  id: '889483296',
  cid: FAKE_CID.toString(),
  streamId: 'k2t6wyfsu4pfxu08vo93w38oyu9itsuf374ekyeno0wb62ozm2o9sznrn8qp72',
  message: 'Fresh request',
  createdAt: new Date('2020-01-02T03:04Z'),
  updatedAt: new Date('2021-02-03T04:05Z'),
}

describe('present by RequestStatus', () => {
  test('PENDING, PROCESSING, FAILED, READY, REPLACED', async () => {
    const statuses = [
      RequestStatus.PENDING,
      RequestStatus.PROCESSING,
      RequestStatus.FAILED,
      RequestStatus.READY,
      RequestStatus.REPLACED,
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
    const merkleCar = carFactory.build()
    const witnessElement = merkleCar.put({ a: 3 })
    const root = merkleCar.put([witnessElement])
    const proofCid = merkleCar.put({ root: root })
    const cid = merkleCar.put({
      proof: proofCid,
      cid: FAKE_CID,
      path: pathLine.encode([PathDirection.L]),
    })
    findByRequestSpy.mockImplementationOnce(async () => {
      return {
        path: pathLine.encode([PathDirection.L]),
        cid: cid,
        proofCid: proofCid,
        request: request,
      } as AnchorWithRequest
    })
    const retrieveCarFileSpy = jest.spyOn(merkleCarService, 'retrieveCarFile')
    retrieveCarFileSpy.mockImplementationOnce(async () => {
      return merkleCar
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
    await expect(service.body(request)).rejects.toThrow(CompletedAnchorlessError)
  })
})
