import { APIGateway } from "aws-sdk"
import { CreateApiKeyRequest, CreateUsagePlanKeyRequest, UsagePlanKey } from "aws-sdk/clients/apigateway.js"
import { ApiKeyData, KeyService } from "../key.js"

const AWS_REGION = process.env.AWS_REGION ?? ''
const DEFAULT_USAGE_PLAN_ID = process.env.API_DEFAULT_USAGE_PLAN_ID ?? ''

export class ApiGateway implements KeyService {
    readonly client: APIGateway

    constructor() {
        this.client = new APIGateway({ region: AWS_REGION })
        if (DEFAULT_USAGE_PLAN_ID == '') {
            throw Error('Missing API_DEFAULT_USAGE_PLAN_ID')
        }
    }

    async init() {
        return
    }

    async createApiKeys(users: Array<ApiKeyData>): Promise<Array<UsagePlanKey>> {
        const results: any[] = []
        for (const user of users) {
            let result = await this.createApiKey(user.user, user.apiKey)
            if (result) {
                results.push(result)
            }
        }
        return results
    }

    async createApiKey(name: string, apiKey?: string): Promise<UsagePlanKey> {
        return await this._registerAPIKey(name, apiKey)
    }

    async _registerAPIKey(name: string, value?: string): Promise<UsagePlanKey> {
        const key: CreateApiKeyRequest = {
            name,
            enabled: true,
            value
        }
        const data = await this.client.createApiKey(key).promise()
        if (!data.id) {
            throw Error('Api key was created but its id is missing!')
        }
        const planKey: CreateUsagePlanKeyRequest = {
            usagePlanId: DEFAULT_USAGE_PLAN_ID,
            keyId: data.id,
            keyType: 'API_KEY'
        }
        return await this.client.createUsagePlanKey(planKey).promise()
    }
}
