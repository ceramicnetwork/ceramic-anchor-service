import { describe, expect, test } from '@jest/globals'
import { Request as ExpReq } from 'express'
import { AnchorRequestParamsParser, RequestAnchorParams } from '../anchor-request-params-parser.js'
import { StreamID } from '@ceramicnetwork/streamid'
import { toCID } from '@ceramicnetwork/common'
import { bases } from 'multiformats/basics'
import { mockRequest } from '../../controllers/__tests__/mock-request.util.js'
import { isRight, isLeft, type Right } from 'codeco'

const FAKE_SIGNED_STREAM_ID = StreamID.fromString(
  'k2t6wzhkhabz5h9xxyrc6qoh1mcj6b0ul90xxkoin4t5bns89e3vh0gyyy1exj'
)

const FAKE_SIGNED_TIP = toCID('bagcqceransp4tpxraev7xfqz5b2kxsj37pffwt2ahh2hfzt4uegvtzc64cja')

const TIMESTAMP_ISO = '2023-01-25T17:32:42.971Z'

const LEGACY_REQUEST_EXAMPLE = mockRequest({
  headers: {
    'Content-Type': 'application/json',
  },
  body: {
    streamId: FAKE_SIGNED_STREAM_ID.toString(),
    cid: FAKE_SIGNED_TIP.toString(),
    timestamp: TIMESTAMP_ISO,
  },
})

const CAR_FILE_REQUEST_EXAMPLE_SIGNED_GENESIS = mockRequest({
  headers: {
    'Content-Type': 'application/vnd.ipld.car',
  },
  body: bases['base64url'].decode(
    'uOqJlcm9vdHOB2CpYJQABcRIgT3FJQeLnnsO6MIl-uaKoEEMtWOoRWLryBIeDtpDEfLVndmVyc2lvbgGpAQFxEiBPcUlB4ueew7owiX65oqgQQy1Y6hFYuvIEh4O2kMR8taNjdGlw2CpYJgABhQESIGyfyb7xASv7lhnodKvJO_vKW09AOfRy5nyhDVnkXuCSaHN0cmVhbUlkWCfOAQMBcRIgziTbUSGEnXjdjPt90kN--q4Z4KTF--6RBDWym0xKS9dpdGltZXN0YW1weBgyMDIzLTAxLTI1VDE3OjMyOjQyLjk3MVqtAQFxEiDOJNtRIYSdeN2M-33SQ376rhngpMX77pEENbKbTEpL16JkZGF0YfZmaGVhZGVyomVtb2RlbFgozgECAYUBEiCIsWIw6kon5HSV8g-usyjT1ohr--q6zx-OOGy_05bUjWtjb250cm9sbGVyc4F4O2RpZDpwa2g6ZWlwMTU1OjE6MHg5MjZlZWIxOTJjMThiN2JlNjA3YTdlMTBjOGU3YTdlOGQ5ZjcwNzQyhQMBhQESIGyfyb7xASv7lhnodKvJO_vKW09AOfRy5nyhDVnkXuCSomdwYXlsb2FkWCQBcRIgZb5XVvi4dxmi46nuSsIRqbFQ-4zYXUiL_Eyu7vQETXtqc2lnbmF0dXJlc4GiaXByb3RlY3RlZFjMeyJhbGciOiJFZERTQSIsImNhcCI6ImlwZnM6Ly9iYWZ5cmVpYWRwcnA2cG5wdDU3bXI2bHlzZ2xrdHFjaWtyaDRmbTN2bm1sb2I0dzQybnNuaHNjeGVndSIsImtpZCI6ImRpZDprZXk6ejZNa2tVM1VIb0JtUlY5ZXozOFplcmtRUFoyV3lNRFFSb1BrM2lZcGp0V0pLQ0RZI3o2TWtrVTNVSG9CbVJWOWV6MzhaZXJrUVBaMld5TURRUm9QazNpWXBqdFdKS0NEWSJ9aXNpZ25hdHVyZVhA9F3nGf-Hp3j81dIMI-Af_Xbp9eiRGE2e1O68t17eK-JBRPneTAwbt_Z1Nsc6IhssYfZBD1fI7HuCV4Oj5p-iAoUCAXESIGW-V1b4uHcZouOp7krCEamxUPuM2F1Ii_xMru70BE17o2JpZNgqWCUAAXESIM4k21EhhJ143Yz7fdJDfvquGeCkxfvukQQ1sptMSkvXZGRhdGGEo2JvcGNhZGRkcGF0aGUvbmFtZWV2YWx1ZWVBcnR1cqNib3BjYWRkZHBhdGhmL2Vtb2ppZXZhbHVlYjopo2JvcGNhZGRkcGF0aGcvZ2VuZGVyZXZhbHVlZE1hbGWjYm9wY2FkZGRwYXRobC9kZXNjcmlwdGlvbmV2YWx1ZWNEZXZkcHJldtgqWCUAAXESIM4k21EhhJ143Yz7fdJDfvquGeCkxfvukQQ1sptMSkvXjwQBcRIgA3xf57Xz79kfLxIy1TgJCon4Vm6tYtweW5psmnkK5DWjYWihYXRnZWlwNDM2MWFwqWNhdWR4OGRpZDprZXk6ejZNa2tVM1VIb0JtUlY5ZXozOFplcmtRUFoyV3lNRFFSb1BrM2lZcGp0V0pLQ0RZY2V4cHgYMjAyMy0wMS0yNlQxNzowNToyNS44MDlaY2lhdHgYMjAyMy0wMS0yNVQxNzowNToyNS44MDlaY2lzc3g7ZGlkOnBraDplaXAxNTU6MToweDkyNmVlYjE5MmMxOGI3YmU2MDdhN2UxMGM4ZTdhN2U4ZDlmNzA3NDJlbm9uY2VqcUhyWGthckFrU2Zkb21haW5pbG9jYWxob3N0Z3ZlcnNpb25hMWlyZXNvdXJjZXOBa2NlcmFtaWM6Ly8qaXN0YXRlbWVudHg8R2l2ZSB0aGlzIGFwcGxpY2F0aW9uIGFjY2VzcyB0byBzb21lIG9mIHlvdXIgZGF0YSBvbiBDZXJhbWljYXOiYXN4hDB4ZjU0YmI4OTk1NGIyODE3MzBjMzBmNTdjNzBiMzcxODNiZTBiNzEwMWUxNTEwMThiZTNmYmIzZTg4Y2RhM2Y1MDZhZGVjNGI5YzBmZjJlZDUwYmI5ODM0NWQ1N2ZjNmZiMWEwY2FlNjRlMWE1MzlhYzNmMzU3MDA3YzllMTc1YzYxYmF0ZmVpcDE5MQ'
  ),
})

const CAR_FILE_INVALID = mockRequest({
  headers: {
    'Content-Type': 'application/vnd.ipld.car',
  },
  body: bases['base64url'].decode('uQ3JlYXRlZEJ5Q2hhdEdQVDRZb3VjYW5Vc2VUaGlzU3RyaW5n'),
})

describe('AnchoRequestParamsParser', () => {
  const parser = new AnchorRequestParamsParser()
  test('parses legacy example 1 properly', () => {
    const validation = parser.parse(LEGACY_REQUEST_EXAMPLE)
    expect(isRight(validation)).toEqual(true)

    const params: RequestAnchorParams = (validation as Right<RequestAnchorParams>).right

    expect(params.streamId).toEqual(StreamID.fromString(LEGACY_REQUEST_EXAMPLE.body.streamId))
    expect(params.cid).toEqual(toCID(LEGACY_REQUEST_EXAMPLE.body.cid))
    expect(params.timestamp).toEqual(new Date(LEGACY_REQUEST_EXAMPLE.body.timestamp))
  })

  test('parses CAR properly', () => {
    const validation = parser.parse(CAR_FILE_REQUEST_EXAMPLE_SIGNED_GENESIS as ExpReq)
    expect(isRight(validation)).toEqual(true)

    const params: RequestAnchorParams = (validation as Right<RequestAnchorParams>).right
    expect(params.streamId).toEqual(FAKE_SIGNED_STREAM_ID)
    expect(params.cid).toEqual(FAKE_SIGNED_TIP)
    expect(params.timestamp).toEqual(new Date(TIMESTAMP_ISO))
  })

  test('isleft indicates invalid car file', () => {
    const validation = parser.parse(CAR_FILE_INVALID as ExpReq)
    expect(isLeft(validation)).toBeTruthy()
  })
})
