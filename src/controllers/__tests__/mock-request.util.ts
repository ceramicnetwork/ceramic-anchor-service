import type { Request as ExpReq, Response as ExpRes } from 'express'
import { jest } from '@jest/globals'
import merge from 'merge-options'

export function mockResponse(): ExpRes {
  const res: any = {}
  res.status = jest.fn(() => res)
  res.json = jest.fn(() => res)
  res.send = jest.fn(() => res)
  return res as ExpRes
}

const REQUEST_DEFAULTS = {
  ip: '127.0.0.1',
  body: {},
}

class MockRequest {
  readonly params: Partial<ExpReq>
  readonly #headers: Record<string, string | string[] | undefined>

  constructor(params: Partial<ExpReq>) {
    this.params = merge(REQUEST_DEFAULTS, params)

    // To mimic req.get provided by Express
    // this.#headers field contains case-insensitive versions of the original headers
    this.#headers = {}
    if (this.params.headers) {
      for (const [name, value] of Object.entries(this.params.headers)) {
        this.#headers[name.toLowerCase()] = value
      }
    }
  }

  get ip() {
    return this.params.ip
  }

  get body() {
    return this.params.body
  }

  get headers() {
    return this.params.headers
  }

  get(headerName: string): string | string[] | undefined {
    return this.#headers[headerName.toLowerCase()]
  }
}

export function mockRequest(input: any = {}): ExpReq {
  return new MockRequest(input) as unknown as ExpReq
}
