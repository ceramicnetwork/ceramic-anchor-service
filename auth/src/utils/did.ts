import { DID, VerifyJWSResult } from 'dids'
import KeyResolver from 'key-did-resolver'

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
    const verifier = new DID({ resolver: KeyResolver.getResolver() })
    return await verifier.verifyJWS(jws)
}
