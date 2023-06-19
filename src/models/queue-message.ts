import { array, string, type, type TypeOf, union } from 'codeco'
import { date } from '@ceramicnetwork/codecs'

export const AnchorBatchQMessage = type(
  {
    bid: string,
    rids: array(string),
  },
  'AnchorBatchQMessage'
)
export type AnchorBatchQMessage = TypeOf<typeof AnchorBatchQMessage>

export const RequestQMessage = type(
  {
    rid: string,
    cid: string,
    sid: string,
    ts: date,
    org: string,
    crt: date,
  },
  'RequestQMessage'
)
export type RequestQMessage = TypeOf<typeof RequestQMessage>

export const QueueMessageData = union([RequestQMessage, AnchorBatchQMessage], 'QueueMessageData')
export type QueueMessageData = TypeOf<typeof QueueMessageData>
