import fetch from 'node-fetch'
import { httpMethods } from "../utils/reqres"

const endpoint = (path?: string) => `http://localhost:3000/dev/api/v0/auth${path || ''}`
describe('api', () => {
    test.skip('verify email', async () => {
        const resp = await fetch(endpoint('/verification'), {
            method: httpMethods.POST,
            body: JSON.stringify({email: 'val@3box.io'})
        })
        console.log(resp.status)
        console.log(await resp.json())
    })

    test.skip('register did', async () => {
        const resp = await fetch(endpoint('/did'), {
            method: httpMethods.POST,
            body: JSON.stringify({
                email: 'val@3box.io',
                dids: ['did:key:z6MktCFRcwLRFQA9WbeDRM7W7kbBdZTHQ2xnPgyxZLq1gCpK'],
                otp: '4a0806fe-de9d-49cb-9ed5-64b7d4481a03'
            })
        })
        console.log(resp.status)
        console.log(await resp.json())
    })

    test.skip('verify email', async () => {
        const resp = await fetch(endpoint('/verification'), {
            method: httpMethods.POST,
            body: JSON.stringify({email: 'val@3box.io'})
        })
        console.log(resp.status)
        console.log(resp.body)
    })

    test.skip('revoke did', async () => {
        const did = 'did:key:z6MktCFRcwLRFQA9WbeDRM7W7kbBdZTHQ2xnPgyxZLq1gCpK'
        const resp = await fetch(endpoint(`/did/${did}`), {
            method: httpMethods.PATCH,
            body: JSON.stringify({
                email: 'val@3box.io',
                did,
                otp: ''
            })
        })
    })
})
