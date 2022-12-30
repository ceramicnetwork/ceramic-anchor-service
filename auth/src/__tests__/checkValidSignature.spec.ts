import { checkValidSignature } from '../utils/did'

test('checkValidSignature', async () => {
    const did = 'did:key:z6MktCFRcwLRFQA9WbeDRM7W7kbBdZTHQ2xnPgyxZLq1gCpK'
    const jws = 'eyJhbGciOiJFZERTQSIsImtpZCI6ImRpZDprZXk6ejZNa3RDRlJjd0xSRlFBOVdiZURSTTdXN2tiQmRaVEhRMnhuUGd5eFpMcTFnQ3BLI3o2TWt0Q0ZSY3dMUkZRQTlXYmVEUk03VzdrYkJkWlRIUTJ4blBneXhaTHExZ0NwSyJ9.eyJub25jZSI6NiwidXJsIjoiaHR0cHM6Ly9vbmxpbmUudGVzdC50cy9hcGkvdjAvYXV0aC9kaWQvZGlkOmtleTp6Nk1rdENGUmN3TFJGUUE5V2JlRFJNN1c3a2JCZFpUSFEyeG5QZ3l4WkxxMWdDcEsvbm9uY2UifQ.cF8rWewGtyGVCWHVNU7-kPhHFedydrmJ_grDWX7C8_Wu4VpovzvQvwtUpKkCXiFvsIzEzbtTjay2hGK4Qt0aAA'
    const did2 = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
    await expect(checkValidSignature(did, jws)).resolves.toBeTruthy()
    await expect(checkValidSignature(did2, jws)).resolves.toBeFalsy()
    await expect(checkValidSignature('', jws)).resolves.toBeFalsy()
    await expect(checkValidSignature(did, '')).resolves.toBeFalsy()
    await expect(checkValidSignature('', '')).resolves.toBeFalsy()
})
