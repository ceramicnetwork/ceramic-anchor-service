import { jest, describe, test, expect } from '@jest/globals'
import type { Config } from 'node-config-ts'
import { AbortOptions, IpfsService } from '../ipfs-service.js'
import { delay, MockIpfsClient } from '../../__tests__/test-utils.js'
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
  test('throw on timeout', async () => {
    const mockIpfsClient = new MockIpfsClient()
    const ipfsPutTimeout = 10
    const service = new IpfsService(FAUX_CONFIG, mockIpfsClient as unknown as IPFS, ipfsPutTimeout)
    const dagPutSpy = jest.spyOn(mockIpfsClient.dag, 'put')
    dagPutSpy.mockImplementation(async (record: any, options: AbortOptions) => {
      await delay(ipfsPutTimeout * 2, options.signal)
      throw new Error(`Original IPFS error`)
    })
    await expect(service.storeRecord(RECORD)).rejects.toThrow(/Timed out storing record in IPFS/)
  })
  test('throw original error', async () => {
    const mockIpfsClient = new MockIpfsClient()
    const service = new IpfsService(FAUX_CONFIG, mockIpfsClient as unknown as IPFS)
    const dagPutSpy = jest.spyOn(mockIpfsClient.dag, 'put')
    dagPutSpy.mockImplementation(async () => {
      throw new Error(`Original IPFS error`)
    })
    await expect(service.storeRecord(RECORD)).rejects.toThrow(/Original IPFS error/)
  })
  test('accept abort signal', async () => {
    const mockIpfsClient = new MockIpfsClient()
    const service = new IpfsService(FAUX_CONFIG, mockIpfsClient as unknown as IPFS)
    const dagPutSpy = jest.spyOn(mockIpfsClient.dag, 'put')
    dagPutSpy.mockImplementation((_, options: AbortOptions) => {
      return new Promise((_, reject) => {
        const done = () => reject(new Error(`From abort signal`))
        if (options.signal?.aborted) done()
        options.signal?.addEventListener('abort', done)
      })
    })
    const abortController = new AbortController()
    const storeRecordP = service.storeRecord(RECORD, { signal: abortController.signal })
    abortController.abort()
    await expect(storeRecordP).rejects.toThrow('From abort signal')
  })
})
