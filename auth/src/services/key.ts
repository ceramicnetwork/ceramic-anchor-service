export type ApiKeyData = {
    user: string
    apiKey?: string
}

export interface KeyService {
    init(): Promise<void>
    createApiKey(user: string, apiKey?: string): Promise<any>
    createApiKeys(users: Array<ApiKeyData>): Promise<any>
}
