import {
    AttributeValue,
    DynamoDBClient,
    GetItemCommand,
    GetItemCommandInput,
    PutItemCommand,
    PutItemCommandInput,
    CreateTableCommand,
    CreateTableCommandInput,
    DescribeTableCommand,
    DescribeTableCommandInput,
    BillingMode,
    ProjectionType,
    ConditionalCheckFailedException,
    UpdateItemCommand,
    UpdateItemCommandInput,
    QueryCommand,
    QueryCommandInput,
    QueryOutput,
} from "@aws-sdk/client-dynamodb"
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb"
import { DateTime } from 'luxon'
import { didRegex } from "../../utils/did"

import { createEmailVerificationCode, Database, DIDStatus, OTPStatus } from "../db"

const AWS_REGION = process.env.AWS_REGION ?? ''

/**
 * Returns current timestamp as unix integer
 * @returns Unix timestamp
 */
const now = (): number => { return DateTime.now().toUnixInteger() }

const OTP_TABLE_NAME = process.env.IS_OFFLINE ? `cas-auth-otp-${now()}` : (process.env.DB_OTP_TABLE_NAME ?? '')
const DID_TABLE_NAME = process.env.IS_OFFLINE ? `cas-auth-did-${now()}` : (process.env.DB_DID_TABLE_NAME ?? '')

class ItemNotFoundError extends Error { }

export type Item = Record<string, AttributeValue>
type ExpressionAttributeValues = Item

export class DynamoDB implements Database {
    name: string
    readonly client: DynamoDBClient
    private readonly _shouldCreateTableIfNotExists: boolean

    constructor(createTableIfNotExists: boolean) {
        this._shouldCreateTableIfNotExists = createTableIfNotExists
        if (DID_TABLE_NAME == '') {
            throw Error('Missing DB_DID_TABLE_NAME')
        }
        if (OTP_TABLE_NAME == '') {
            throw Error('Missing DB_OTP_TABLE_NAME')
        }
        this.client = process.env.IS_OFFLINE
            ? new DynamoDBClient({ endpoint: 'http://localhost:8000' })
            : new DynamoDBClient({ region: AWS_REGION })
    }

    async init() {
        for (const tableName of [OTP_TABLE_NAME, DID_TABLE_NAME]) {
            if (this._shouldCreateTableIfNotExists) {
                await this._createTableIfNotExists(tableName)
            } else {
                const shouldThrow = true
                await this._checkTableExists(tableName, shouldThrow)
            }
        }
    }

    private async _createTableIfNotExists(tableName: string): Promise<void> {
        if (await this._checkTableExists(tableName)) return

        const input: CreateTableCommandInput = {
            TableName: tableName,
            KeySchema: [
                { AttributeName: 'PK', KeyType: 'HASH' },
                { AttributeName: 'SK', KeyType: 'RANGE' }
            ],
            AttributeDefinitions: [
                { AttributeName: 'PK', AttributeType: 'S' },
                { AttributeName: 'SK', AttributeType: 'S' },
                { AttributeName: 'GSI-1-PK', AttributeType: 'S' },
                { AttributeName: 'GSI-1-SK', AttributeType: 'S' },
            ],
            BillingMode: BillingMode.PAY_PER_REQUEST,
            GlobalSecondaryIndexes: [
                {
                    IndexName: 'GSI-1',
                    KeySchema: [
                        { AttributeName: 'GSI-1-PK', KeyType: 'HASH' },
                        { AttributeName: 'GSI-1-SK', KeyType: 'RANGE' }
                    ],
                    Projection: { ProjectionType: ProjectionType.ALL }
                }
            ]
        }
        try {
            await this.client.send(new CreateTableCommand(input))
        } catch (error) {
            console.error(error)
            throw error
        }
    }

    private async _checkTableExists(tableName: string, shouldThrow: boolean = false): Promise<boolean> {
        const input: DescribeTableCommandInput = {
            TableName: tableName
        }
        try {
            await this.client.send(new DescribeTableCommand(input))
            return true
        } catch (error) {
            if (shouldThrow) {
                throw error
            } else {
                return false
            }
        }
    }

    /**
     * Get email address from registered DID
     * @param did DID
     * @returns email address
     */
    async getEmail(did: string): Promise<string | undefined> {
        try {
            return await this._getItemAttribute(DID_TABLE_NAME, did, did, 'email')
        } catch (err) {
            if (err instanceof ItemNotFoundError) {
                console.error('Item not found.')
            } else {
                console.error(err)
            }
            return
        }
    }

    async getNonce(did: string): Promise<number | undefined> {
        try {
            return Number(await this._getItemAttribute(DID_TABLE_NAME, did, did, 'nonce'))
        } catch (err) {
            if (err instanceof ItemNotFoundError) {
                console.error('Nonce not found. DID may not be registered.')
            } else {
                console.error(err)
            }
            return
        }
    }

    async updateNonce(did: string, nonce: number): Promise<boolean> {
        const input: UpdateItemCommandInput = {
            TableName: DID_TABLE_NAME,
            Key: marshall({
                'PK': did,
                'SK': did
            }),
            UpdateExpression: `SET nonce=:nonce, updated_at_unix=:updated_at_unix`,
            ConditionExpression: '(attribute_exists(PK)) AND (nonce < :nonce)',
            ExpressionAttributeValues: marshall({
                'nonce': nonce,
                'updated_at_unix': now(),
            }),
            ReturnValues: 'ALL_NEW'
        }
        try {
            await this.client.send(new UpdateItemCommand(input))
            return true
        } catch (err) {
            if (err instanceof ConditionalCheckFailedException) {
                console.error('DID was not found or nonce is too small.')
            } else {
                console.error(err)
            }
            return false
        }
    }

    async getDIDRegistration(did: string, status?: DIDStatus): Promise<any> {
        try {
            const data = await this._getItem(DID_TABLE_NAME, did, did)
            if (data.status != status) {
                throw new Error(`Item found but status is not ${status}`)
            }
            return data
        } catch (err) {
            console.error(err)
        }
        return
    }

    async createEmailVerificationCode(email: string): Promise<string | undefined> {
        try {
            return await createEmailVerificationCode(email, this)
        } catch (err) {
            console.error(err)
        }
        return
    }

    async _getRevokedOTPs(email: string): Promise<Item[]> {
        const expressionAttributeValues = marshall({
            ':PK': email,
            ':revoked': OTPStatus.Revoked
        })
        const filterExpression = 'contains (curr_status, :revoked)'
        return await this._queryItems(OTP_TABLE_NAME, expressionAttributeValues, filterExpression)
    }

    async _getActiveOTPs(email: string): Promise<Item[]> {
        const expressionAttributeValues = marshall({
            ':PK': email,
            ':active': OTPStatus.Active
        })
        const filterExpression = 'contains (curr_status, :active)'
        return await this._queryItems(OTP_TABLE_NAME, expressionAttributeValues, filterExpression)
    }

    _checkOTPExpired(item: Item): boolean {
        const data = unmarshall(item)
        return (data.expires_at_unix < now())
    }

    async _expireOTP(item: Item): Promise<void> {
        await this._updateOTP(item, OTPStatus.Expired)
    }

    async _revokeOTP(item: Item): Promise<void> {
        await this._updateOTP(item, OTPStatus.Revoked)
    }

    private async _updateOTP(item: Item, next_status: OTPStatus): Promise<void> {
        const data = unmarshall(item)
        const input: UpdateItemCommandInput = {
            TableName: OTP_TABLE_NAME,
            Key: marshall({
                'PK': data.PK,
                'SK': data.SK
            }),
            UpdateExpression: `SET curr_status=:next_status, updated_at_unix=:updated_at_unix`,
            ConditionExpression: '(attribute_exists(PK)) AND NOT contains(curr_status, :next_status)',
            ExpressionAttributeValues: marshall({
                ':next_status': next_status,
                ':updated_at_unix': now(),
            }),
            ReturnValues: 'ALL_NEW'
        }
        await this.client.send(new UpdateItemCommand(input))
    }

    async _addOTP(email: string, otp: string): Promise<void> {
        const params: PutItemCommandInput = {
            TableName: OTP_TABLE_NAME,
            Item: marshall({
                'PK': email,
                'SK': otp,
                'attempts': 0,
                'curr_status': OTPStatus.Active,
                'created_at_unix': now(),
                'updated_at_unix': now(),
                'expires_at_unix': DateTime.now().plus({ minutes: 30 }).toUnixInteger()
            })
        }
        await this.client.send(new PutItemCommand(params))
    }

    async registerDIDs(email: string, otp: string, dids: Array<string>): Promise<Array<any> | undefined> {
        if (!await this._checkCorrectOTP(email, otp)) return
        const shouldCheckOTPAgain = false

        const results: any[] = []
        for (const did of dids) {
            if (didRegex.test(did)) {
                let result = await this.registerDID(email, otp, did, shouldCheckOTPAgain)
                results.push(result)
            }
        }
        return results
    }

    async registerDID(email: string, otp: string, did: string, checkOTP: boolean = true): Promise<any | undefined> {
        if (checkOTP) {
            if(!await this._checkCorrectOTP(email, otp)) return
        }

        const nonce = 0
        const status = DIDStatus.Active
        const params: PutItemCommandInput = {
            TableName: DID_TABLE_NAME,
            Item: marshall({
                'PK':  did,
                'SK': did,
                'email': email,
                'nonce': nonce,
                'curr_status': status,
                'created_at_unix': now(),
                'updated_at_unix': now(),
            }),
            ConditionExpression: 'attribute_not_exists(PK)'
        }

        try {
            await this.client.send(new PutItemCommand(params))
            return { email, did, nonce, status }
        } catch(err) {
            if (err instanceof ConditionalCheckFailedException) {
                console.error('Already registered this DID.')
            } else {
                console.error(err)
            }
            return
        }
    }

    async revokeDID(email: string, otp: string, did: string): Promise<any> {
        if(!await this._checkCorrectOTP(email, otp)) return false

        const input: UpdateItemCommandInput = {
            TableName: DID_TABLE_NAME,
            Key: marshall({
                'PK': did,
                'SK': did
            }),
            UpdateExpression: `SET curr_status=:curr_status, updated_at_unix=:updated_at_unix`,
            ConditionExpression: '(attribute_exists(PK)) AND contains(email, :email) AND NOT contains(curr_status, :curr_status)',
            ExpressionAttributeValues: marshall({
                ':email': email,
                ':curr_status': DIDStatus.Revoked,
                ':updated_at_unix': now(),
            }),
            ReturnValues: 'ALL_NEW'
        }
        try {
            const output = await this.client.send(new UpdateItemCommand(input))
            if (output) {
                if (output.Attributes) {
                    const attributes = unmarshall(output.Attributes)
                    return {
                        email: attributes.email,
                        did: attributes.PK,
                        status: attributes.curr_status
                    }
                }
            } else {
                console.warn('Command succeeded without return values')
                return { email, did, status: DIDStatus.Revoked }
            }
        } catch (err) {
            if (err instanceof ConditionalCheckFailedException) {
                console.error('DID was not found or is already revoked.')
            } else {
                console.error(err)
            }
            return
        }
    }

    private async _checkCorrectOTP(email: string, otp: string): Promise<boolean> {
        const input: UpdateItemCommandInput = {
            TableName: OTP_TABLE_NAME,
            Key: marshall({
                'PK': email,
                'SK': otp
            }),
            UpdateExpression: `SET curr_status=:next_status, updated_at_unix=:updated_at_unix`,
            ConditionExpression: '(attribute_exists(PK)) AND (attribute_exists(SK)) AND contains(curr_status, :prev_status)',
            ExpressionAttributeValues: marshall({
                ':next_status': OTPStatus.Used,
                ':prev_status': OTPStatus.Active,
                ':updated_at_unix': now(),
            }),
            ReturnValues: 'ALL_NEW'
        }

        try {
            const output = await this.client.send(new UpdateItemCommand(input))
            if (output) {
                if (output.Attributes) {
                    const attributes = unmarshall(output.Attributes)
                    if (attributes.expires_at_unix > now()) {
                        return true
                    }
                }
            }
            console.log(`Bad OTP for email ${email}`)
            return false
        } catch (err) {
            if (err instanceof ConditionalCheckFailedException) {
                console.error('OTP not found or not active.')
                return false
            }
            throw err
        }
    }

    private async _getItemAttribute(tableName: string, pk: string, sk: string, attribute: string): Promise<any> {
        const data = await this._getItem(tableName, pk, sk)
        return data[attribute]
    }

    private async _getItem(tableName: string, pk: string, sk: string): Promise<any> {
        const params: GetItemCommandInput = {
            TableName: tableName,
            Key: marshall({
                'PK': pk,
                'SK': sk
            }),
        }
        const results = await this.client.send(new GetItemCommand(params));
        if (!results.Item) {
            throw new ItemNotFoundError('Item not found')
        }
        const data = unmarshall(results.Item || {})
        return data
    }

    private async _queryItems(
        tableName: string,
        expressionAttributeValues: ExpressionAttributeValues,
        filterExpression?: string
    ): Promise<Item[]> {
        const input: QueryCommandInput = {
            TableName: tableName,
            KeyConditionExpression: 'PK=:PK',
            FilterExpression: filterExpression,
            ExpressionAttributeValues: expressionAttributeValues
        }
        const results = await this.client.send(new QueryCommand(input));
        if (!results.Items) {
            throw new ItemNotFoundError('Items not found')
        }
        return results.Items
    }
}
