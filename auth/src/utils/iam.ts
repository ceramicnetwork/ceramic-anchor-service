export function generatePolicy(principalId: string, policyDocumentOptions?: { effect: string, resource: string}, usageIdentifierKey?: string) {
    const authResponse: any = {
        principalId,
    }

    if (policyDocumentOptions) {
        const policyDocument = {
        Version: '2012-10-17',
        Statement: [
        {
            Action: 'execute-api:Invoke',
            Effect: policyDocumentOptions.effect,
            Resource: policyDocumentOptions.resource
        }]}
        authResponse.policyDocument = policyDocument
    }

    if (usageIdentifierKey) {
        authResponse.usageIdentifierKey = usageIdentifierKey
        authResponse.context = {
            "authId": usageIdentifierKey
        }
    }
    // Add custom properties on context if needed
    // authResponse.context
    return authResponse
}
