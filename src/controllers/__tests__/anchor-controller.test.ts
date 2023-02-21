import { describe, expect, jest, test } from '@jest/globals'
import type { AnchorService } from '../../services/anchor-service.js'
import { AnchorController } from '../anchor-controller.js'
import { mockRequest, mockResponse } from './mock-request.util.js'
import { StatusCodes } from 'http-status-codes'

describe('anchor', () => {
  test('call AnchorService::anchorRequests', async () => {
    const anchorRequestsMock = jest.fn()
    const fauxAnchorService = {
      anchorRequests: anchorRequestsMock,
    } as unknown as AnchorService
    const controller = new AnchorController(fauxAnchorService)
    const request = mockRequest()
    const response = mockResponse()
    await controller.anchor(request, response)
    expect(anchorRequestsMock).toBeCalledTimes(1)
    expect(response.status).toBeCalledWith(StatusCodes.OK)
  })
})
