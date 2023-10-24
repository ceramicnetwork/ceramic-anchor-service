import { describe, expect, test } from '@jest/globals'
import { Request as ExpReq } from 'express'
import {
  AnchorRequestParamsParser,
  RequestAnchorParams,
  RequestAnchorParamsV2,
} from '../anchor-request-params-parser.js'
import { StreamID } from '@ceramicnetwork/streamid'
import { toCID } from '@ceramicnetwork/common'
import { bases } from 'multiformats/basics'
import { GenesisFields } from '../../models/metadata.js'
import { asDIDString } from '@ceramicnetwork/codecs'
import { mockRequest } from '../../controllers/__tests__/mock-request.util.js'
import { isRight, isLeft, type Right } from 'codeco'

const FAKE_SIGNED_STREAM_ID = StreamID.fromString(
  'k2t6wzhkhabz5h9xxyrc6qoh1mcj6b0ul90xxkoin4t5bns89e3vh0gyyy1exj'
)

const FAKE_SIGNED_TIP = toCID('bagcqceransp4tpxraev7xfqz5b2kxsj37pffwt2ahh2hfzt4uegvtzc64cja')

const FAKE_UNSIGNED_STREAM_ID = StreamID.fromString(
  'k2t6wyfsu4pg1tpfbjf20op9tmfofulf9tyiyvc2wueupetzrcnp8r4wmnhw47'
)

const FAKE_UNSIGNED_TIP = toCID('bafyreigoetnvcimetv4n3dh3pxjeg7x2vym6bjgf7pxjcbbvwknuyssl24')

const TIMESTAMP_ISO = '2023-01-25T17:32:42.971Z'

const FAKE_CACAO='test'  // the p.domain of the cacao in our test blob

const FAKE_MODEL='kjzl6hvfrbw6c5ws6n17gx7zgb6veprsbb0b2m1x7x026rorhhu0mtuqz4d5zjn'

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

const CAR_FILE_REQUEST_EXAMPLE_UNSIGNED_GENESIS = mockRequest({
  headers: {
    'Content-Type': 'application/vnd.ipld.car',
  },
  body: bases['base64url'].decode(
    'uOqJlcm9vdHOB2CpYJQABcRIgax-ozdCQvEUBpYyAxxvdm2oCT9Ybk_a8N3W28qhEkOlndmVyc2lvbgGtAQFxEiDOJNtRIYSdeN2M-33SQ376rhngpMX77pEENbKbTEpL16JkZGF0YfZmaGVhZGVyomVtb2RlbFgozgECAYUBEiCIsWIw6kon5HSV8g-usyjT1ohr--q6zx-OOGy_05bUjWtjb250cm9sbGVyc4F4O2RpZDpwa2g6ZWlwMTU1OjE6MHg5MjZlZWIxOTJjMThiN2JlNjA3YTdlMTBjOGU3YTdlOGQ5ZjcwNzQyqAEBcRIgax-ozdCQvEUBpYyAxxvdm2oCT9Ybk_a8N3W28qhEkOmjY3RpcNgqWCUAAXESIM4k21EhhJ143Yz7fdJDfvquGeCkxfvukQQ1sptMSkvXaHN0cmVhbUlkWCfOAQABcRIgziTbUSGEnXjdjPt90kN--q4Z4KTF--6RBDWym0xKS9dpdGltZXN0YW1weBgyMDIzLTAxLTI1VDE3OjMyOjQyLjk3MVo'
  ),
})

const CAR_FILE_REQUEST_EXAMPLE_SIGNED_GENESIS_WITH_CACAO = mockRequest({
  headers: {
    'Content-Type': 'application/vnd.ipld.car',
  },
  body: bases['base64url'].decode('uOqJlcm9vdHOB2CpYJQABcRIgwcxsif-rrekn_a2-Bhct6FEDdHK6u3AJb3_B6tvawXFndmVyc2lvbgGqAQFxEiDBzGyJ_6ut6Sf9rb4GFy3oUQN0crq7cAlvf8Hq29rBcaNjdGlw2CpYJgABhQESINQg_eQxpZ-MKScNxNX4g_mokMkhcrlm3iikxiMgcW1VaHN0cmVhbUlkWCjOAQABhQESINQg_eQxpZ-MKScNxNX4g_mokMkhcrlm3iikxiMgcW1VaXRpbWVzdGFtcHgYMjAyMy0wOS0wOFQxNToxMDoyNi43ODBahQMBhQESINQg_eQxpZ-MKScNxNX4g_mokMkhcrlm3iikxiMgcW1VomdwYXlsb2FkWCQBcRIgkwe64uSAOO9atHATIYB1C7U-K7UfhS3FGU_WiXHyL65qc2lnbmF0dXJlc4GiaXByb3RlY3RlZFjMeyJhbGciOiJFZERTQSIsImNhcCI6ImlwZnM6Ly9iYWZ5cmVpZTJyNnRtc3Z3ZmF0bGhweHhxbTUzbnB3d3czNnBlanNibmEzNnN3Z3ZocW03dWt6cTNrYSIsImtpZCI6ImRpZDprZXk6ejZNa3F1REdwdGUzNFN6akxrNm5KNkxXc0hIS1Q1RVBndG5xdHo5cFV5QzQ1SGVNI3o2TWtxdURHcHRlMzRTempMazZuSjZMV3NISEtUNUVQZ3RucXR6OXBVeUM0NUhlTSJ9aXNpZ25hdHVyZVhAK4M_E69hCRw-WOGPMAr9TGtj8K5qyl0BkFuqJRxRqOlvbj-mh9O5hbZDfJQM5cVx6BQp7nBiMNWJUgRKwXhLDbABAXESIJMHuuLkgDjvWrRwEyGAdQu1Piu1H4UtxRlP1olx8i-uomRkYXRhoWVoZWxsb3QxLTAuMzcxNDMxMjk4MjUwNzE5M2ZoZWFkZXKiZnVuaXF1ZXBvOTArZUNSUlJrVUpGNUJia2NvbnRyb2xsZXJzgXg7ZGlkOnBraDplaXAxNTU6NToweEY2ZjcyMWQ4MzdjMzI5ZGZiRkZkNzhjYWRCNDk0YWYxOTg3OTg3NEaKBAFxEiCaj6bJVsUE1nfe8Gd219rW355EyC0G_Ssap4M_RWYbUKNhaKFhdGdlaXA0MzYxYXCpY2F1ZHg4ZGlkOmtleTp6Nk1rcXVER3B0ZTM0U3pqTGs2bko2TFdzSEhLVDVFUGd0bnF0ejlwVXlDNDVIZU1jZXhweBgyMDIzLTA5LTE1VDE1OjEwOjI2LjU4MVpjaWF0eBgyMDIzLTA5LTA4VDE1OjEwOjI2LjU4MVpjaXNzeDtkaWQ6cGtoOmVpcDE1NTo1OjB4RjZmNzIxZDgzN2MzMjlkZmJGRmQ3OGNhZEI0OTRhZjE5ODc5ODc0RmVub25jZWprbE82clBaRW1sZmRvbWFpbmR0ZXN0Z3ZlcnNpb25hMWlyZXNvdXJjZXOBa2NlcmFtaWM6Ly8qaXN0YXRlbWVudHg8R2l2ZSB0aGlzIGFwcGxpY2F0aW9uIGFjY2VzcyB0byBzb21lIG9mIHlvdXIgZGF0YSBvbiBDZXJhbWljYXOiYXN4hDB4YmNjZDY4ZDI3NTRlNDc0NGE4YTFkMGZlYzBiMmM2YWZlZjM1MTE3Yzg0NzRmZjE0NTczNTg3NzQ2MjA0ZTQ5YTdmYTFlYmNhYzNiZmJkYjY4MTM4ZDJiYTllN2Q3Y2Q5Yzc1ZjU1MmQxYTI3Yzk4ZmQ5OTMzYmI1NmFjMGU5ZTAxYmF0ZmVpcDE5MQ'
  ),
})

const CAR_FILE_REQUEST_EXAMPLE_WITH_MODEL = mockRequest({
  headers: {
    'Content-Type': 'application/vnd.ipld.car',
  },
  body: bases['base64url'].decode(
    'uOqJlcm9vdHOB2CpYJQABcRIgQtL_mq5jv6WdKws8V3DwrUhSUnms7JUdb0aT_3sFXDFndmVyc2lvbgGqAQFxEiBC0v-armO_pZ0rCzxXcPCtSFJSeazslR1vRpP_ewVcMaNjdGlw2CpYJgABhQESIFXEyGyqkZ6hvYy558-KIMaMkhW5OEvuCqxXzx3z5_a-aHN0cmVhbUlkWCjOAQMBhQESIFXEyGyqkZ6hvYy558-KIMaMkhW5OEvuCqxXzx3z5_a-aXRpbWVzdGFtcHgYMjAyMy0xMC0yM1QxNjo0MzowOS43MTlaugIBhQESIFXEyGyqkZ6hvYy558-KIMaMkhW5OEvuCqxXzx3z5_a-omdwYXlsb2FkWCQBcRIgtJJfzDZHy1YFja9reKpEoDnosliErYS8h3HSlFCLFu5qc2lnbmF0dXJlc4GiaXByb3RlY3RlZFiBeyJhbGciOiJFZERTQSIsImtpZCI6ImRpZDprZXk6ejZNa3N3bXg2QjhCa3FhMUJ6a3NvdmNjWUhOZGtxc3U5R0hHUmJjMW1ucWg5UlJ4I3o2TWtzd214NkI4QmtxYTFCemtzb3ZjY1lITmRrcXN1OUdIR1JiYzFtbnFoOVJSeCJ9aXNpZ25hdHVyZVhAXk1o0Op1W7dJT7jwL7LWi568YlTNADsSI2Q_m75Kb2RXs1mkEgAnksDG-mCDjhWRCZdx2dp05PVK9kddllQnDaoGAXESILSSX8w2R8tWBY2va3iqRKA56LJYhK2EvIdx0pRQixbuomRkYXRhqWZpc3N1ZXJ4OGRpZDprZXk6ejZNa2dodkdITG9iTEVkajFiZ1JMaFM0TFBHSkF2Yk1BMXRuMnpjUnlxbVlVNUxDaXByb29mVHlwZXRFZDI1NTE5U2lnbmF0dXJlMjAxOGpwcm9vZlZhbHVleJBleUpoYkdjaU9pSkZaRVJUUVNJc0ltTnlhWFFpT2xzaVlqWTBJbDBzSW1JMk5DSTZabUZzYzJWOS4uczN4V2x6MlduWDNJaDBlTVZIRnBYQjdTRUZ4NVNQb3VHWEFiZmNVU1BNZWdGcm1HYVM1OFM0Q2ROenp0elNCMjBqM01rUGJjVVZSYWd2bEdOSUpTQlFsaXNzdWFuY2VEYXRleBgyMDIyLTA3LTIzVDA1OjE3OjUzLjc0NlpscHJvb2ZDcmVhdGVkeBgyMDIyLTA3LTIzVDA1OjE3OjUzLjc0N1pscHJvb2ZQdXJwb3Nlb2Fzc2VydGlvbk1ldGhvZG5leHBpcmF0aW9uRGF0ZXgYMjAyMi0xMC0yMVQwNToxNzo1My43NDZacWdpdGNvaW5QYXNzcG9ydElkeD9ranpsNmtjeW03dzh5ODJmZzZndWQ5MXVhNWR2b2szM244cW5wNXNkbGpwbnNiOHJndTViNW1wdGkwbHh3dm5ydmVyaWZpY2F0aW9uTWV0aG9keGlkaWQ6a2V5Ono2TWtnaHZHSExvYkxFZGoxYmdSTGhTNExQR0pBdmJNQTF0bjJ6Y1J5cW1ZVTVMQyN6Nk1rZ2h2R0hMb2JMRWRqMWJnUkxoUzRMUEdKQXZiTUExdG4yemNSeXFtWVU1TENmaGVhZGVypGNzZXBlbW9kZWxlbW9kZWxYKM4BAgGFARIgI_-XRam_FzV3nlPWMV3YjqwzrNP3leux4_Fjpjd_sDNmdW5pcXVlTCkRWqdoKgigCq5F02tjb250cm9sbGVyc4F4OGRpZDprZXk6ejZNa3N3bXg2QjhCa3FhMUJ6a3NvdmNjWUhOZGtxc3U5R0hHUmJjMW1ucWg5UlJ4'
  ),
})


const CAR_FILE_INVALID = mockRequest({
  headers: {
    'Content-Type': 'application/vnd.ipld.car',
  },
  body: bases['base64url'].decode(
    'uQ3JlYXRlZEJ5Q2hhdEdQVDRZb3VjYW5Vc2VUaGlzU3RyaW5n'
  ),
})


const CAR_FILE_FAKE_GENESIS_FIELDS: GenesisFields = {
  controllers: [asDIDString('did:pkh:eip155:1:0x926eeb192c18b7be607a7e10c8e7a7e8d9f70742')],
  model: StreamID.fromBytes(
    bases['base64'].decode('mzgECAYUBEiCIsWIw6kon5HSV8g+usyjT1ohr++q6zx+OOGy/05bUjQ')
  ),
}

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

  test('parses CAR with signed genesis properly', () => {
    const validation = parser.parse(CAR_FILE_REQUEST_EXAMPLE_SIGNED_GENESIS as ExpReq)
    expect(isRight(validation)).toEqual(true)

    const params: RequestAnchorParams = (validation as Right<RequestAnchorParams>).right
    expect(params.streamId).toEqual(FAKE_SIGNED_STREAM_ID)
    expect(params.cid).toEqual(FAKE_SIGNED_TIP)
    expect(params.timestamp).toEqual(new Date(TIMESTAMP_ISO))
    expect((params as RequestAnchorParamsV2).genesisFields).toEqual(CAR_FILE_FAKE_GENESIS_FIELDS)
  })

  test('parses CAR with unsigned genesis properly', () => {
    const validation = parser.parse(CAR_FILE_REQUEST_EXAMPLE_UNSIGNED_GENESIS as ExpReq)
    expect(isRight(validation)).toEqual(true)

    const params: RequestAnchorParams = (validation as Right<RequestAnchorParams>).right
    expect(params.streamId).toEqual(FAKE_UNSIGNED_STREAM_ID)
    expect(params.cid).toEqual(FAKE_UNSIGNED_TIP)
    expect(params.timestamp).toEqual(new Date(TIMESTAMP_ISO))
    expect((params as RequestAnchorParamsV2).genesisFields).toEqual(CAR_FILE_FAKE_GENESIS_FIELDS)
  })

  test('parses CAR file with signed genesis with cacao properly', () => {
    const validation = parser.parse(CAR_FILE_REQUEST_EXAMPLE_SIGNED_GENESIS_WITH_CACAO as ExpReq)
    expect(isRight(validation)).toEqual(true)

    const params: RequestAnchorParams = (validation as Right<RequestAnchorParams>).right
    expect(params.cacaoDomain).toEqual(FAKE_CACAO)
    expect((params as RequestAnchorParamsV2).genesisFields.model).toBeUndefined()
  })


  test('parses CAR file with model properly', () => {
    const validation = parser.parse(CAR_FILE_REQUEST_EXAMPLE_WITH_MODEL as ExpReq)
    expect(isRight(validation)).toEqual(true)

    const params: RequestAnchorParams = (validation as Right<RequestAnchorParams>).right
    expect((params as RequestAnchorParamsV2).genesisFields.model.toString()).toEqual(FAKE_MODEL)
  })

  test('isleft indicates invalid car file', () => {
    const validation =  parser.parse(CAR_FILE_INVALID as ExpReq)
    expect(isLeft(validation)).toBeTruthy()
  })

})
