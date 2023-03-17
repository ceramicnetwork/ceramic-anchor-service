import * as t from 'io-ts'

export const AnchorBatch = t.type({
  bid: t.string,
  rids: t.array(t.string),
})

export type AnchorBatch = t.TypeOf<typeof AnchorBatch>
