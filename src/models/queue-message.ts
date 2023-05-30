import { array, string, type, type TypeOf } from 'codeco'

export const AnchorBatch = type({
  bid: string,
  rids: array(string),
})

export type AnchorBatch = TypeOf<typeof AnchorBatch>
