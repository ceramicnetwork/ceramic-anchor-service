import { jest, describe, test, expect } from '@jest/globals'
import type { Config } from 'node-config-ts'
import {
  IPFS_GET_RETRIES,
  IPFS_GET_TIMEOUT,
  IPFS_PUT_TIMEOUT,
  IpfsService,
} from '../ipfs-service.js'
import { MockIpfsClient, times } from '../../__tests__/test-utils.js'
import type { IPFS } from 'ipfs-core-types'
import type { AbortOptions } from '../abort-options.type.js'
import type { CID } from 'multiformats/cid'
import { DelayAbortedError, Utils } from '../../utils.js'

const FAUX_CONFIG = {
  ipfsConfig: {
    pubsubTopic: '/faux',
  },
} as Config

const RECORD = { hello: 'world' }

let mockIpfsClient: MockIpfsClient
let service: IpfsService

beforeEach(() => {
  mockIpfsClient = new MockIpfsClient()
  service = new IpfsService(FAUX_CONFIG, mockIpfsClient as unknown as IPFS)
})

describe('storeRecord', () => {
  test('store IPFS record', async () => {
    const dagPutSpy = jest.spyOn(mockIpfsClient.dag, 'put')
    await service.storeRecord(RECORD)
    expect(dagPutSpy).toBeCalledWith(RECORD, { timeout: IPFS_PUT_TIMEOUT })
  })
  test('pass AbortSignal', async () => {
    const dagPutSpy = jest.spyOn(mockIpfsClient.dag, 'put')
    const abortController = new AbortController()
    await service.storeRecord(RECORD, { signal: abortController.signal })
    expect(dagPutSpy).toBeCalledWith(RECORD, {
      signal: abortController.signal,
      timeout: IPFS_PUT_TIMEOUT,
    })
  })
})

describe('retrieveRecord', () => {
  test('cache record', async () => {
    const cid = await service.storeRecord(RECORD)
    const dagGetSpy = jest.spyOn(mockIpfsClient.dag, 'get')
    expect(dagGetSpy).toBeCalledTimes(0)
    await service.retrieveRecord(cid) // Call ipfs.dag.get
    expect(dagGetSpy).toBeCalledTimes(1)
    dagGetSpy.mockClear()
    await service.retrieveRecord(cid) // Use cached value. Do not use ipfs.dag.get
    expect(dagGetSpy).toBeCalledTimes(0)
  })
  test('cache record if path provided', async () => {
    const cid = await service.storeRecord(RECORD)
    const dagGetSpy = jest.spyOn(mockIpfsClient.dag, 'get')
    expect(dagGetSpy).toBeCalledTimes(0)
    await service.retrieveRecord(cid, { path: '/link' }) // Call ipfs.dag.get
    expect(dagGetSpy).toBeCalledTimes(1)
    dagGetSpy.mockClear()
    await service.retrieveRecord(cid, { path: '/link' }) // Use cached value. Do not use ipfs.dag.get
    expect(dagGetSpy).toBeCalledTimes(0)
    dagGetSpy.mockClear()
    await service.retrieveRecord(cid) // Without `path` it is a different value. Retrieve from ipfs.dag.get.
    expect(dagGetSpy).toBeCalledTimes(1)
  })
  test('retry', async () => {
    const cid = await service.storeRecord(RECORD)
    const dagGetSpy = jest.spyOn(mockIpfsClient.dag, 'get')
    times(IPFS_GET_RETRIES - 1).forEach(() => {
      dagGetSpy.mockImplementationOnce(() => Promise.reject(new Error(`Nope`)))
    })
    await service.retrieveRecord(cid)
    expect(dagGetSpy).toBeCalledTimes(IPFS_GET_RETRIES)
    for (const i of times(IPFS_GET_RETRIES)) {
      expect(dagGetSpy.mock.calls[i]).toEqual([cid, { timeout: IPFS_GET_TIMEOUT }])
    }
  })
  test('retry: fail if attempts are exhausted', async () => {
    const cid = await service.storeRecord(RECORD)
    const dagGetSpy = jest.spyOn(mockIpfsClient.dag, 'get')
    times(IPFS_GET_RETRIES).forEach(() => {
      dagGetSpy.mockImplementationOnce(() => Promise.reject(new Error(`Nope`)))
    })
    await expect(service.retrieveRecord(cid)).rejects.toThrow(
      /Failed to retrieve IPFS record for CID/
    )
  })
  test('accept AbortSignal', async () => {
    const abortController = new AbortController()
    const cid = await service.storeRecord(RECORD)
    const dagGetSpy = jest.spyOn(mockIpfsClient.dag, 'get')
    // Simulate ipfs.dag.get call that throws when aborted
    times(IPFS_GET_RETRIES - 1).forEach(() => {
      dagGetSpy.mockImplementationOnce(async (cid: CID, options: AbortOptions) => {
        await Utils.delay(10000, options.signal)
      })
    })
    const retrieveRecordP = service.retrieveRecord(cid, { signal: abortController.signal })
    abortController.abort()
    // Delay is huge, so ipfs.dag.get is called just once
    expect(dagGetSpy).toBeCalledTimes(1)
    // Pass original AbortSignal to ipfs.dag.get
    expect(dagGetSpy).toBeCalledWith(cid, {
      timeout: IPFS_GET_TIMEOUT,
      signal: abortController.signal,
    })
    // Do not retry if an exception is due to AbortSignal
    await expect(retrieveRecordP).rejects.toThrow(DelayAbortedError)
  })
})
