import { DateTime } from 'luxon'
import fetch from 'node-fetch'
import { DIDStatus } from '../services/db'
import { httpMethods } from "../utils/reqres"

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
