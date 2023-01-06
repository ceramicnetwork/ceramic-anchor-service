import { DID } from 'dids'
import * as random from '@stablelib/random'
import { Ed25519Provider } from 'key-did-provider-ed25519'
import * as KeyDidResolver from 'key-did-resolver'

export async function makeDID(): Promise<DID> {
  const seed = random.randomBytes(32)
  const provider = new Ed25519Provider(seed)
  const resolver = KeyDidResolver.getResolver()
  const did = new DID({ provider, resolver })
  await did.authenticate()
  return did
}
