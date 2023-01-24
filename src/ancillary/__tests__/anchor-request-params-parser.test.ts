import { describe, expect, test } from '@jest/globals'
import { Request as ExpReq } from "express"
import { AnchorRequestParamsParser, RequestAnchorParams, RequestAnchorParamsV2 } from "../anchor-request-params-parser.js";
import { StreamID } from "@ceramicnetwork/streamid"
import { toCID } from "@ceramicnetwork/common"
import { bases } from "multiformats/basics";
import {GenesisFields} from "../../models/metadata";
import {asDIDString} from "../did-string";
import * as uint8arrays from "uint8arrays";

const FAKE_SIGNED_STREAM_ID = StreamID.fromString(
  'kjzl6hvfrbw6c5btpw2il5tino080437i2he8i8nqps9mudpik7qppl1or0jisn'
)

const FAKE_SIGNED_TIP = toCID('bagcqcerabssdaiiphihqlu5fsxl34h7nyu3bn3ss3ejilp6idgc7ipyn6htq')

const FAKE_UNSIGNED_STREAM_ID = StreamID.fromString(
  'k2t6wyfsu4pfy0gyeuovb1trrwhpqiko7ovwn96z05ojbqqo8n4ed4rd2bjez1'
)

const FAKE_UNSIGNED_TIP = toCID('bafyreibvghsoepolkrvfsryqoacumtywovn3w73vh32uq6nbjn526omvru')

const TIMESTAMP_ISO = "2023-01-24T14:52:39.773Z"

const LEGACY_REQUEST_EXAMPLE: Record<string, any> = {
  headers: {
    "Content-Type": "application/json"
  },
  body: {
    streamId: FAKE_SIGNED_STREAM_ID.toString(),
    cid: FAKE_SIGNED_TIP.toString(),
    timestamp: TIMESTAMP_ISO
  }
}

const CAR_FILE_REQUEST_EXAMPLE_SIGNED_GENESIS: Record<string, any> = {
  headers: {
    "Content-Type": "application/vnd.ipld.car"
  },
  body: bases["base64url"].decode("uOqJlcm9vdHOB2CpYJQABcRIgqJSnDGGAC9QO5fluDOzvwsMgfiefz-crDlW4FK3PdAtndmVyc2lvbgGnAQFxEiColKcMYYAL1A7l-W4M7O_CwyB-J5_P5ysOVbgUrc90C6NjdGlwWCUBhQESIAykMCEPOg8F06WV174f7cU2Fu5S2RKFv8gZhfQ_DfHnaHN0cmVhbUlkWCjOAQIBhQESIAykMCEPOg8F06WV174f7cU2Fu5S2RKFv8gZhfQ_DfHnaXRpbWVzdGFtcHgYMjAyMy0wMS0yNFQxNDo1MjozOS43NzNaugIBhQESIAykMCEPOg8F06WV174f7cU2Fu5S2RKFv8gZhfQ_DfHnomdwYXlsb2FkWCQBcRIgKUl41INh3f94akTEnGil-GM7X9txIueMaQ_TtVsmEctqc2lnbmF0dXJlc4GiaXByb3RlY3RlZFiBeyJhbGciOiJFZERTQSIsImtpZCI6ImRpZDprZXk6ejZNa3diNUhIWHlmMnB4dnE3TlU0dWVQWEhtUllOWkRFYlY0V1dRWnczTk1keWJBI3o2TWt3YjVISFh5ZjJweHZxN05VNHVlUFhIbVJZTlpERWJWNFdXUVp3M05NZHliQSJ9aXNpZ25hdHVyZVhAQPkqeTA-Haj9wNTVKDTAK4LDinqvLL9GGtevM-FUY5R9zdlYqq0c8pj3JaY15RJHhMuwqIEK1ZAnWmhEkjIxDLsFAXESIClJeNSDYd3_eGpExJxopfhjO1_bcSLnjGkP07VbJhHLomRkYXRhpmRuYW1lZ015TW9kZWxldmlld3OhaWxpbmtlZERvY6NkdHlwZXByZWxhdGlvbkRvY3VtZW50ZW1vZGVseD9ranpsNmh2ZnJidzZjNzg2Ymc5ZDhzeGx6ZXB3Z2N3dGVmdGN4YnpoaGp3YmRwaThxcnhhNHV0cDB4Y2VmbGxocHJvcGVydHlrbGlua2VkRG9jSURmc2NoZW1hpmR0eXBlZm9iamVjdGUkZGVmc6FvQ2VyYW1pY1N0cmVhbUlEo2R0eXBlZnN0cmluZ2V0aXRsZW9DZXJhbWljU3RyZWFtSURpbWF4TGVuZ3RoGGRnJHNjaGVtYXgsaHR0cHM6Ly9qc29uLXNjaGVtYS5vcmcvZHJhZnQvMjAyMC0xMi9zY2hlbWFocmVxdWlyZWSBa2xpbmtlZERvY0lEanByb3BlcnRpZXOha2xpbmtlZERvY0lEoWQkcmVmdyMvJGRlZnMvQ2VyYW1pY1N0cmVhbUlEdGFkZGl0aW9uYWxQcm9wZXJ0aWVz9GlyZWxhdGlvbnOha2xpbmtlZERvY0lEomR0eXBlaGRvY3VtZW50ZW1vZGVseD9ranpsNmh2ZnJidzZjNzg2Ymc5ZDhzeGx6ZXB3Z2N3dGVmdGN4YnpoaGp3YmRwaThxcnhhNHV0cDB4Y2VmbGxrZGVzY3JpcHRpb25wU21va2UgVGVzdCBNb2RlbG9hY2NvdW50UmVsYXRpb26hZHR5cGVkbGlzdGZoZWFkZXKiZW1vZGVsUs4BBAFxcQsACWhtb2RlbC12MWtjb250cm9sbGVyc4F4OGRpZDprZXk6ejZNa3diNUhIWHlmMnB4dnE3TlU0dWVQWEhtUllOWkRFYlY0V1dRWnczTk1keWJB")
}

const CAR_FILE_REQUEST_EXAMPLE_UNSIGNED_GENESIS: Record<string, any> = {
  headers: {
    "Content-Type": "application/vnd.ipld.car"
  },
  body: bases["base64url"].decode("uOqJlcm9vdHOB2CpYJQABcRIgTxVu9Jjv6SAwCUb0CsL6nf_9pAvjegKTLUpDL5dUcktndmVyc2lvbgGNAQFxEiA1MeTiPctUallHEHAFRk8WdVu7f3U-9Uh5oUt7rzmVjaFmaGVhZGVyomVtb2RlbFLOAQQBcXELAAlobW9kZWwtdjFrY29udHJvbGxlcnOBeDhkaWQ6a2V5Ono2TWt3YjVISFh5ZjJweHZxN05VNHVlUFhIbVJZTlpERWJWNFdXUVp3M05NZHliQaUBAXESIE8VbvSY7-kgMAlG9ArC-p3__aQL43oCky1KQy-XVHJLo2N0aXBYJAFxEiA1MeTiPctUallHEHAFRk8WdVu7f3U-9Uh5oUt7rzmVjWhzdHJlYW1JZFgnzgEAAXESIDUx5OI9y1RqWUcQcAVGTxZ1W7t_dT71SHmhS3uvOZWNaXRpbWVzdGFtcHgYMjAyMy0wMS0yNFQxNDo1MjozOS43NzNa")
}

const CAR_FILE_FAKE_GENESIS_FIELDS: GenesisFields = {
  controllers: [asDIDString("did:key:z6Mkwb5HHXyf2pxvq7NU4uePXHmRYNZDEbV4WWQZw3NMdybA")],
  model: uint8arrays.fromString("zgEEAXFxCwAJaG1vZGVsLXYx", "base64")
}

describe('AnchoRequestParamsParser', () => {
  test('parses legacy example 1 properly', () => {
    const parsedParams: RequestAnchorParams = (new AnchorRequestParamsParser()).parse(LEGACY_REQUEST_EXAMPLE as ExpReq)
    expect(parsedParams.streamId).toEqual(StreamID.fromString(LEGACY_REQUEST_EXAMPLE.body.streamId))
    expect(parsedParams.tip).toEqual(toCID(LEGACY_REQUEST_EXAMPLE.body.cid))
    expect(parsedParams.timestamp).toEqual(new Date(LEGACY_REQUEST_EXAMPLE.body.timestamp))
  })

  test('parses CAR with signed genesis properly', () => {
    const parsedParams: RequestAnchorParams = (new AnchorRequestParamsParser()).parse(CAR_FILE_REQUEST_EXAMPLE_SIGNED_GENESIS as ExpReq)

    expect(parsedParams.streamId).toEqual(FAKE_SIGNED_STREAM_ID)
    expect(parsedParams.tip).toEqual(FAKE_SIGNED_TIP)
    expect(parsedParams.timestamp).toEqual(new Date(TIMESTAMP_ISO))
    expect((parsedParams as RequestAnchorParamsV2).genesisFields).toEqual(CAR_FILE_FAKE_GENESIS_FIELDS)
  })

  test('parses CAR with unsigned genesis properly', () => {
    const parsedParams: RequestAnchorParams = (new AnchorRequestParamsParser()).parse(CAR_FILE_REQUEST_EXAMPLE_UNSIGNED_GENESIS as ExpReq)

    expect(parsedParams.streamId).toEqual(FAKE_UNSIGNED_STREAM_ID)
    expect(parsedParams.tip).toEqual(FAKE_UNSIGNED_TIP)
    expect(parsedParams.timestamp).toEqual(new Date(TIMESTAMP_ISO))
    expect((parsedParams as RequestAnchorParamsV2).genesisFields).toEqual(CAR_FILE_FAKE_GENESIS_FIELDS)
  })
})
