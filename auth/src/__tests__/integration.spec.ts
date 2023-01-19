import { DateTime } from 'luxon'
import fetch from 'node-fetch'
import { ConfigKey, DIDStatus } from '../services/db.js'
import { encodeAdminCredentials } from '../utils/auth.js'
import { httpMethods } from '../utils/reqres.js'

// Note: The dynamodb implementation allows duplicate otps under a single email,
// however in production the `generateOTP` function will produce random uuids.
const OTP = '29161b43-758a-40f3-aece-97758bac617a'
const REAL_DID = 'did:key:z6MktCFRcwLRFQA9WbeDRM7W7kbBdZTHQ2xnPgyxZLq1gCpK'
const EMAIL_ADDRESS = 'val@3box.io'

let didCount = 0

describe('/verification', () => {
    test('sends an otp', async () => {
        const resp = await resetOTP()
        expect(resp.status).toBe(200)
    })
})

describe('/did', () => {
    beforeEach(async () => {
        const resp = await resetOTP()
        expect(resp.status).toBe(200)
    })

    test('registers a did', async () => {
        const email = 'val@3box.io'
        const dids = [randomDID()]
        const resp = await fetch(endpoint('/did'), {
            method: httpMethods.POST,
            body: JSON.stringify({
                email,
                dids,
                otp: OTP
            })
        })
        expect(resp.status).toBe(200)
        await expect(resp.json()).resolves.toEqual([
            {email, did: dids[0], nonce: '0', status: 'Active'}
        ])
    })

    test('registers multiple dids', async () => {
        const email = EMAIL_ADDRESS
        const dids = [
            randomDID(),
            randomDID(),
            randomDID()
        ]
        const resp = await fetch(endpoint('/did'), {
            method: httpMethods.POST,
            body: JSON.stringify({
                email,
                dids,
                otp: OTP
            })
        })
        expect(resp.status).toBe(200)
        await expect(resp.json()).resolves.toEqual([
            {email, did: dids[0], nonce: '0', status: 'Active'},
            {email, did: dids[1], nonce: '0', status: 'Active'},
            {email, did: dids[2], nonce: '0', status: 'Active'}
        ])
    })

    test('can not register duplicate dids', async () => {
        const did = randomDID()
        const dids = [
            did,
            did,
            randomDID()
        ]
        const resp = await fetch(endpoint('/did'), {
            method: httpMethods.POST,
            body: JSON.stringify({
                email: 'val@3box.io',
                dids,
                otp: OTP
            })
        })
        expect(resp.status).toBe(400)
        await expect(resp.json()).resolves.toEqual({ error: 'Validation Failed' })
    })

    test('can not register bad did', async () => {
        const dids = [
            '123'
        ]
        const resp = await fetch(endpoint('/did'), {
            method: httpMethods.POST,
            body: JSON.stringify({
                email: 'val@3box.io',
                dids,
                otp: OTP
            })
        })
        expect(resp.status).toBe(400)
        await expect(resp.json()).resolves.toEqual({ error: 'Validation Failed' })
    })

    test('can not register bad dids', async () => {
        const dids = [
            '123',
            'abc',
            randomDID()
        ]
        const resp = await fetch(endpoint('/did'), {
            method: httpMethods.POST,
            body: JSON.stringify({
                email: 'val@3box.io',
                dids,
                otp: OTP
            })
        })
        expect(resp.status).toBe(400)
        await expect(resp.json()).resolves.toEqual({ error: 'Validation Failed' })
    })

    test('revoke did', async () => {
        const dids = [
            randomDID(),
            randomDID()
        ]
        await fetch(endpoint('/did'), {
            method: httpMethods.POST,
            body: JSON.stringify({
                email: EMAIL_ADDRESS,
                dids,
                otp: OTP
            })
        })

        let resp

        // wrong email
        await resetOTP()
        resp = await fetch(endpoint(`/did/${dids[0]}`), {
            method: httpMethods.PATCH,
            body: JSON.stringify({
                email: 'wrong@3box.io',
                otp: OTP
            })
        })

        expect(resp.status).toBe(400)
        await expect(resp.json()).resolves.toEqual({ error: 'Could not revoke DID' })

        // wrong otp
        await resetOTP()
        resp = await fetch(endpoint(`/did/${dids[0]}`), {
            method: httpMethods.PATCH,
            body: JSON.stringify({
                email: EMAIL_ADDRESS,
                otp: 'wrongotp'
            })
        })

        expect(resp.status).toBe(400)
        await expect(resp.json()).resolves.toEqual({ error: 'Could not revoke DID' })

        // wrong did
        await resetOTP()
        resp = await fetch(endpoint(`/did/${randomDID()}`), {
            method: httpMethods.PATCH,
            body: JSON.stringify({
                email: EMAIL_ADDRESS,
                otp: OTP
            })
        })

        expect(resp.status).toBe(400)
        await expect(resp.json()).resolves.toEqual({ error: 'Could not revoke DID' })

        // did owned by email
        await resetOTP()
        resp = await fetch(endpoint(`/did/${dids[1]}`), {
            method: httpMethods.PATCH,
            body: JSON.stringify({
                email: EMAIL_ADDRESS,
                otp: OTP
            })
        })

        expect(resp.status).toBe(200)
        await expect(resp.json()).resolves.toEqual({
            email: EMAIL_ADDRESS,
            did: dids[1],
            status: DIDStatus.Revoked
        })

        // did owned by email
        await resetOTP()
        resp = await fetch(endpoint(`/did/${dids[0]}`), {
            method: httpMethods.PATCH,
            body: JSON.stringify({
                email: EMAIL_ADDRESS,
                otp: OTP
            })
        })

        expect(resp.status).toBe(200)
        await expect(resp.json()).resolves.toEqual({
            email: EMAIL_ADDRESS,
            did: dids[0],
            status: DIDStatus.Revoked
        })
    })
})

describe.only('/config', () => {
    test('non-admin can not get config', async () => {
        let resp = await fetch(endpoint(`/config/key/${ConfigKey.RegistrationEnabled}`), {
            method: httpMethods.GET
        })
        expect(resp.status).toBe(400)
        resp = await fetch(endpoint(`/config/key/process`), {
            method: httpMethods.GET
        })
        expect(resp.status).toBe(400)
        const credentials = encodeAdminCredentials('admin', 'VX8Q3wY)wT^#')
        resp = await fetch(endpoint(`/config/key/${ConfigKey.RegistrationEnabled}`), {
            method: httpMethods.GET,
            headers: { authorization: `Basic ${credentials}`}
        })
        expect(resp.status).toBe(400)
    })
    test('admin can not get invalid config', async () => {
        const credentials = encodeAdminCredentials('admin', 'admin')
        let resp = await fetch(endpoint(`/config/key/process`), {
            method: httpMethods.GET,
            headers: { authorization: `Basic ${credentials}`}
        })
        expect(resp.status).toBe(400)
    })
    test('admin can get valid config', async () => {
        const credentials = encodeAdminCredentials('admin', 'admin')
        let resp = await fetch(endpoint(`/config/key/${ConfigKey.RegistrationEnabled}`), {
            method: httpMethods.GET,
            headers: { authorization: `Basic ${credentials}`}
        })
        expect(resp.status).toBe(200)
        const out: any = await resp.json()
        expect(out.PK).toBe(ConfigKey.RegistrationEnabled)
    })
    test('non-admin can not get config keys', async () => {
        let resp = await fetch(endpoint(`/config/keys`), {
            method: httpMethods.GET
        })
        expect(resp.status).toBe(400)
        const credentials = encodeAdminCredentials('admin', 'IccDw^$802N')
        resp = await fetch(endpoint(`/config/keys`), {
            method: httpMethods.GET,
            headers: { authorization: `Basic ${credentials}`}
        })
        expect(resp.status).toBe(400)
    })
    test('admin can get config keys', async () => {
        const credentials = encodeAdminCredentials('admin', 'admin')
        let resp = await fetch(endpoint(`/config/keys`), {
            method: httpMethods.GET,
            headers: { authorization: `Basic ${credentials}`}
        })
        expect(resp.status).toBe(200)
        await expect(resp.json()).resolves.toEqual([ConfigKey.RegistrationEnabled])
    })
    test('non-admin can not set config', async () => {
        const data = {
            PK: ConfigKey.RegistrationEnabled,
            v: true
        }
        let resp = await fetch(endpoint('/config'), {
            method: httpMethods.PUT,
            body: JSON.stringify(data)
        })
        expect(resp.status).toBe(400)

        const credentials = encodeAdminCredentials('admin', 'wY)wT]VX8Q3^#~Y3')
        resp = await fetch(endpoint('/config'), {
            method: httpMethods.PUT,
            headers: { authorization: `Basic ${credentials}`},
            body: JSON.stringify(data)
        })
        expect(resp.status).toBe(400)
    })
    test('admin can set valid config', async () => {
        const data = {
            PK: ConfigKey.RegistrationEnabled,
            v: true
        }
        const credentials = encodeAdminCredentials('admin', 'admin')
        let resp = await fetch(endpoint('/config'), {
            method: httpMethods.PUT,
            headers: { authorization: `Basic ${credentials}`},
            body: JSON.stringify(data)
        })
        expect(resp.status).toBe(200)
        await expect(resp.json()).resolves.toEqual(data)
        resp = await fetch(endpoint(`/config/key/${ConfigKey.RegistrationEnabled}`), {
            method: httpMethods.GET,
            headers: { authorization: `Basic ${credentials}`}
        })
        expect(resp.status).toBe(200)
        const out: any = await resp.json()
        expect(out.PK).toBe(ConfigKey.RegistrationEnabled)
        expect(out.v).toBe(true)
    })
    test('admin can not set random config', async () => {
        const data = {
            PK: 'shutdown',
            v: true
        }
        const credentials = encodeAdminCredentials('admin', 'admin')
        const resp = await fetch(endpoint('/config'), {
            method: httpMethods.PUT,
            headers: { authorization: `Basic ${credentials}`},
            body: JSON.stringify(data)
        })
        expect(resp.status).toBe(400)
    })
})

async function resetOTP(email: string = EMAIL_ADDRESS): Promise<any> {
    return await fetch(endpoint('/verification'), {
        method: httpMethods.POST,
        body: JSON.stringify({email})
    })
}

function randomDID(): string {
    didCount++
    return `${REAL_DID}:${DateTime.now().toUnixInteger()}:${didCount}`
}

function endpoint(path?: string) {
    return `http://localhost:3000/dev/api/v0/auth${path || ''}`
}
