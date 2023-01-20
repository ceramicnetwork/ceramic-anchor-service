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
    ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb"
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb"
import { DateTime } from 'luxon'
import { didRegex } from '../../utils/did.js'
import { now } from '../../utils/datetime.js'

import {
    ConfigKey,
    createEmailVerificationCode,
    Database,
    DIDResult,
    DIDStatus,
    OTPStatus
} from '../db.js'
import { KeyService } from "../key.js"

const AWS_REGION = process.env.AWS_REGION ?? ''
const INITIAL_NONCE = '0'

/**
 * Returns current timestamp as unix integer
 * @returns Unix timestamp
 */
const CONFIG_TABLE_NAME = process.env.IS_OFFLINE ? `cas-auth-config-${now()}` : (process.env.DB_CONFIG_TABLE_NAME ?? '')
const DID_TABLE_NAME = process.env.IS_OFFLINE ? `cas-auth-did-${now()}` : (process.env.DB_DID_TABLE_NAME ?? '')
const OTP_TABLE_NAME = process.env.IS_OFFLINE ? `cas-auth-otp-${now()}` : (process.env.DB_OTP_TABLE_NAME ?? '')

class ItemNotFoundError extends Error { }

export type Item = Record<string, AttributeValue>
type ExpressionAttributeValues = Item

export class DynamoDB implements Database {
    name: string
    readonly client: DynamoDBClient
    readonly keyService: KeyService
    private readonly _shouldCreateTableIfNotExists: boolean

    constructor(createTableIfNotExists: boolean) {
        this._shouldCreateTableIfNotExists = createTableIfNotExists
        if (CONFIG_TABLE_NAME == '') {
            throw Error('Missing DB_CONFIG_TABLE_NAME')
        }
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
        for (const tableName of [CONFIG_TABLE_NAME, DID_TABLE_NAME, OTP_TABLE_NAME]) {
            if (this._shouldCreateTableIfNotExists) {
                await this._createTableIfNotExists(tableName)
            } else {
                const shouldThrow = true
                await this._checkTableExists(tableName, shouldThrow)
            }
        }
    }

    private async _createTableIfNotExists(tableName: string): Promise<void> {
        const shouldthrow = process.env.IS_OFFLINE ? false : true
        if (await this._checkTableExists(tableName, shouldthrow)) return

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
            if (error instanceof ResourceNotFoundException) {
                // console.log(`Table (${tableName}) does yet not exist`)
            } else {
                console.error(error)
            }
            if (shouldThrow) {
                throw error
            } else {
                return false
            }
        }
    }

    async getConfig(key: ConfigKey | string, valueOnly?: boolean): Promise<any | null | undefined> {
        let data
        try {
            data = await this._getItem(CONFIG_TABLE_NAME, key, key)
        } catch (err) {
            if (err instanceof ItemNotFoundError) {
                // console.log('Config has not been set for this key')
                data = {
                    PK: key,
                    v: null
                }
            } else {
                console.error(err)
            }
        }
        if (data) {
            if (valueOnly) {
                return data.v
            }
            return data
        }
        return
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

    /**
     * If the DID is registered and has the given status, returns the item from the db.
     * Otherwise returns undefined.
     * @param did DID as string
     * @param status DIDStatus
     * @returns Registration data or undefined
     */
    async getDIDRegistration(did: string, status?: DIDStatus): Promise<any | undefined> {
        try {
            const data = await this._getItem(DID_TABLE_NAME, did, INITIAL_NONCE)
            if (data.curr_status != status) {
                throw new Error(`Item found but status is not ${status}`)
            }
            return data
        } catch (err) {
            if (err instanceof ResourceNotFoundException) {
                console.error('Resource not found')
            } else {
                console.error(err)
            }
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

    /**
     * Helper function for `createEmailVerificationCode`
     * @param email
     * @returns
     */
    async _getRevokedOTPs(email: string): Promise<Item[]> {
        const expressionAttributeValues = marshall({
            ':PK': email,
            ':revoked': OTPStatus.Revoked
        })
        const filterExpression = 'contains(curr_status, :revoked)'
        return await this._queryItems(OTP_TABLE_NAME, expressionAttributeValues, filterExpression)
    }

    /**
     * Helper function for `createEmailVerificationCode`
     * @param email
     * @returns
     */
    async _getActiveOTPs(email: string): Promise<Item[]> {
        const expressionAttributeValues = marshall({
            ':PK': email,
            ':active': OTPStatus.Active
        })
        const filterExpression = 'contains(curr_status, :active)'
        return await this._queryItems(OTP_TABLE_NAME, expressionAttributeValues, filterExpression)
    }

    /**
     * Helper function for `createEmailVerificationCode`
     * @param email
     * @returns
     */
    _checkOTPExpired(item: Item): boolean {
        const data = unmarshall(item)
        return (data.expires_at_unix < now())
    }

    /**
     * Helper function for `createEmailVerificationCode`
     * @param email
     * @returns
     */
    async _expireOTP(item: Item): Promise<void> {
        await this._updateOTP(item, OTPStatus.Expired)
    }

    /**
     * Helper function for `createEmailVerificationCode`
     * @param email
     * @returns
     */
    async _revokeOTP(item: Item): Promise<void> {
        await this._updateOTP(item, OTPStatus.Revoked)
    }

    /**
     * Helper function for `createEmailVerificationCode`
     * @param email
     * @returns
     */
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

    /**
     * Helper function for `createEmailVerificationCode`
     * @param email
     * @returns
     */
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

    /**
     * Adds a new nonce for the did if the did is active
     * @param did
     * @param nonce
     * @returns `{did, nonce}`
     */
    async addNonce(did: string, nonce: string): Promise<any | undefined> {
        const activeDID = await this.getDIDRegistration(did, DIDStatus.Active)
        if (!activeDID) return
        const input: PutItemCommandInput = {
            TableName: DID_TABLE_NAME,
            Item: marshall({
                'PK': did,
                'SK': nonce,
                'created_at_unix': now(),
                'updated_at_unix': now(),
                // TODO: add TTL if timestamp comes with the nonce
            }),
            ConditionExpression: 'attribute_not_exists(PK)'
        }
        try {
            await this.client.send(new PutItemCommand(input))
            return { did, nonce }
        } catch (err) {
            if (err instanceof ConditionalCheckFailedException) {
                console.error('DID was not found or nonce has already been used.')
            } else {
                console.error(err)
            }
            return
        }
    }

    async registerDIDs(email: string, otp: string, dids: Array<string>, skipOTP?: boolean): Promise<Array<DIDResult> | undefined> {
        if (!skipOTP) {
            if (!await this._checkCorrectOTP(email, otp)) return
        }
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

    async registerDID(email: string, otp: string, did: string, checkOTP: boolean = true): Promise<DIDResult | undefined> {
        if (checkOTP) {
            if (!await this._checkCorrectOTP(email, otp)) return
        }
        // TODO: limit to 4 dids before email

        const status = DIDStatus.Active
        const params: PutItemCommandInput = {
            TableName: DID_TABLE_NAME,
            Item: marshall({
                'PK': did,
                'SK': INITIAL_NONCE,
                'email': email,
                'curr_status': status,
                'created_at_unix': now(),
                'updated_at_unix': now(),
            }),
            ConditionExpression: 'attribute_not_exists(PK)'
        }

        try {
            await this.client.send(new PutItemCommand(params))
            return { email, did, nonce: INITIAL_NONCE, status }
        } catch (err) {
            if (err instanceof ConditionalCheckFailedException) {
                console.error('Already registered this DID.')
            } else {
                console.error(err)
            }
            return
        }
    }

    async revokeDID(email: string, otp: string, did: string): Promise<any> {
        if (!await this._checkCorrectOTP(email, otp)) return false

        const input: UpdateItemCommandInput = {
            TableName: DID_TABLE_NAME,
            Key: marshall({
                'PK': did,
                'SK': INITIAL_NONCE
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

    async updateConfig(key: string, value: any): Promise<any> {
        const input: UpdateItemCommandInput = {
            TableName: CONFIG_TABLE_NAME,
            Key: marshall({
                'PK': key,
                'SK': key
            }),
            UpdateExpression: `SET v=:v, updated_at_unix=:updated_at_unix`,
            ExpressionAttributeValues: marshall({
                ':v': value,
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
                        PK: attributes.PK,
                        v: attributes.v
                    }
                }
            } else {
                console.warn('Command succeeded without return values')
                return { PK: key, v: value }
            }
        } catch (err) {
            console.error(err)
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
            ConditionExpression: '(attribute_exists(PK)) AND contains(curr_status, :prev_status)',
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
