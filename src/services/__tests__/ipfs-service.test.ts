import { jest, describe, test, expect } from '@jest/globals'
import type { Config } from 'node-config-ts'
import { IpfsService } from '../ipfs-service.js'
import { delay, MockIpfsClient, randomCID } from '../../__tests__/test-utils.js'
import type { IPFS } from 'ipfs-core-types'

const FAUX_CONFIG = {
  ipfsConfig: {
    pubsubTopic: '/faux',
  },
} as Config

const RECORD = { hello: 'world' }

describe('storeRecord', () => {
  test('store IPFS record', async () => {
    const mockIpfsClient = new MockIpfsClient()
    const service = new IpfsService(FAUX_CONFIG, mockIpfsClient as unknown as IPFS)
    const dagPutSpy = jest.spyOn(mockIpfsClient.dag, 'put')
    await service.storeRecord(RECORD)
    expect(dagPutSpy).toBeCalledWith(RECORD)
  })
  test('throw on timeout', async () => {
    const mockIpfsClient = new MockIpfsClient()
    const ipfsPutTimeout = 10
    const service = new IpfsService(FAUX_CONFIG, mockIpfsClient as unknown as IPFS, ipfsPutTimeout)
    const dagPutSpy = jest.spyOn(mockIpfsClient.dag, 'put')
    dagPutSpy.mockImplementationOnce(async () => {
      await delay(ipfsPutTimeout * 2)
      return randomCID()
    })
    await expect(service.storeRecord(RECORD)).rejects.toThrow(/Timed out storing record in IPFS/)
  })
  test.todo('accept abort signal')
})
