import { jest, describe, test, expect } from '@jest/globals'
import type { Config } from 'node-config-ts'
import { IpfsService } from '../ipfs-service.js'
import { MockIpfsClient } from '../../__tests__/test-utils.js'
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
    expect(dagPutSpy.mock.lastCall[0]).toEqual(RECORD)
  })
  test('pass timeout and AbortSignal', async () => {
    const mockIpfsClient = new MockIpfsClient()
    const timeout = 10
    const service = new IpfsService(FAUX_CONFIG, mockIpfsClient as unknown as IPFS, timeout)
    const dagPutSpy = jest.spyOn(mockIpfsClient.dag, 'put')
    const abortController = new AbortController()
    await service.storeRecord(RECORD, { signal: abortController.signal })
    expect(dagPutSpy).toBeCalledWith(RECORD, { signal: abortController.signal, timeout: timeout })
  })
})
