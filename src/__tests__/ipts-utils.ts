import { IpfsApi } from '@ceramicnetwork/common'
import type { Multiaddr } from 'multiaddr'

export async function swarmConnect(...instances: Array<IpfsApi>): Promise<void> {
  const pairs: Array<{ origin: IpfsApi; to: Multiaddr }> = []
  for (const a of instances) {
    for (const b of instances) {
      if (a !== b) {
        pairs.push({
          origin: a,
          to: (await b.id()).addresses[0],
        })
      }
    }
  }
  await Promise.all(pairs.map((connection) => connection.origin.swarm.connect(connection.to)))
}
