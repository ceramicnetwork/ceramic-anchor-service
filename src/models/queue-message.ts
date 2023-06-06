import { array, string, type, type TypeOf } from 'codeco'

export const AnchorBatch = type(
  {
    bid: string,
    rids: array(string),
  },
  'AnchorBatch'
)
export type AnchorBatch = TypeOf<typeof AnchorBatch>

export const QueueMessageData = AnchorBatch
export type QueueMessageData = AnchorBatch
