import { DID, VerifyJWSResult } from 'dids'
import KeyDIDResolver from 'key-did-resolver'
import { Ed25519Provider } from "key-did-provider-ed25519"
import * as u8a from 'uint8arrays'
import { Resolver } from 'did-resolver'
import { randomBytes } from '@stablelib/random'

export const didRegex = new RegExp(/\S+:\S+:\S+/)

export function checkValidDID(did: string): boolean {
    return didRegex.test(did)
}

export async function checkValidSignature(did: string, jws: string): Promise<boolean> {
    if (did && jws) {
        if (did != '' && jws != '') {
            try {
                const result = await parseSignature(jws)
                return did == result.didResolutionResult.didDocument?.id
            } catch (err) {
                if (err instanceof SyntaxError) {
                    console.error('Invalid jws:', jws)
                } else {
                    console.error(err)
                }
            }
        }
    }
    return false
}

export async function parseSignature(jws: string): Promise<VerifyJWSResult> {
    // @ts-ignore
    const verifier = new DID({ resolver: KeyDIDResolver.getResolver() })
    return await verifier.verifyJWS(jws)
}

export function createRandomDID(): DID {
    const seed = randomBytes(32)
    // @ts-ignore
    return new DID({ provider: new Ed25519Provider(seed), resolver: KeyDIDResolver.getResolver() })
}
