export enum DIDStatus {
    Active = 'Active',
    Revoked = 'Revoked'
}

export interface Database {
    name: string
    client: any
    init: () => Promise<void>
    getEmail: (did: string) => Promise<string | undefined>
    getNonce: (did: string) => Promise<number | undefined>
    registerDID: (email: string, did: string) => Promise<any>
    revokeDID: (email: string, did: string, nonce: number) => Promise<boolean>
}
