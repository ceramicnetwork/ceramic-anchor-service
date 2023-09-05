import { array, string, type, type TypeOf, union, number, optional } from 'codeco'
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

export const IpfsPubSubPublishQMessage = type(
  {
    createdAt: date,
    topic: string,
    data: array(number),
    timeoutMs: optional(number),
  },
  'IpfsPubSubPublishQMessage'
)
export type IpfsPubSubPublishQMessage = TypeOf<typeof IpfsPubSubPublishQMessage>

export const QueueMessageData = union(
  [RequestQMessage, AnchorBatchQMessage, IpfsPubSubPublishQMessage],
  'QueueMessageData'
)
export type QueueMessageData = TypeOf<typeof QueueMessageData>
