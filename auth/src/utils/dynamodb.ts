import {
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
    UpdateItemCommandInput
} from "@aws-sdk/client-dynamodb"
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb"
import { Database, DIDStatus } from "./db"

const AWS_REGION = process.env.AWS_REGION ?? ''
const DB_TABLE_NAME = process.env.IS_OFFLINE ? `did-auth-${Date.now()}` : process.env.DB_TABLE_NAME

class ItemNotFoundError extends Error {}

export class DynamoDB implements Database {
    name: string
    readonly client: any
    private readonly _shouldCreateTableIfNotExists: boolean

    constructor(createTableIfNotExists: boolean) {
        this._shouldCreateTableIfNotExists = createTableIfNotExists
        if (DB_TABLE_NAME == '') {
            throw Error('Failed to create database instance: Missing DB_TABLE_NAME')
        }
        this.name = String(DB_TABLE_NAME)
        this.client = process.env.IS_OFFLINE
          ? new DynamoDBClient({ endpoint: 'http://localhost:8000' })
          : new DynamoDBClient({ region: AWS_REGION })
    }

    async init() {
        if (this._shouldCreateTableIfNotExists) {
            await this._createTableIfNotExists()
        } else {
            const shouldThrow = true
            await this._checkTableExists(shouldThrow)
        }
    }

    private _createTableIfNotExists = async (): Promise<void> => {
        this._checkTableExists()

        const inputCreate: CreateTableCommandInput = {
            TableName: this.name,
            KeySchema: [       
                { AttributeName: 'PK', KeyType: 'HASH' },
                { AttributeName: 'SK', KeyType: 'RANGE' }
            ],
            AttributeDefinitions: [       
                { AttributeName: 'PK', AttributeType: 'S' },
                { AttributeName: 'SK', AttributeType: 'S' },
                { AttributeName: 'GSI-1-PK', AttributeType: 'S'},
                { AttributeName: 'GSI-1-SK', AttributeType: 'S'},
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
            await this.client.send(new CreateTableCommand(inputCreate))
        } catch (error) {
            console.error(error)
            throw error
        }
    }

    _checkTableExists = async (shouldThrow: boolean = false): Promise<boolean> =>  {
        const inputDescribe: DescribeTableCommandInput = {
            TableName: this.name
        }
        try {
            await this.client.send(new DescribeTableCommand(inputDescribe))
            return true
        } catch (error) {
            if (shouldThrow) {
                throw error
            } else {
                return false
            }
        }
    }

    getEmail = async (did: string): Promise<string | undefined> => {
        try {
            return await this._getItemAttribute(did, 'email')
        } catch(err) {
            if (err instanceof ItemNotFoundError) {
                console.error('Item not found.')
            } else {
                console.error(err)
            }
            return
        }
    }

    getNonce = async (did: string): Promise<number | undefined> => {
        try {
            return Number(await this._getItemAttribute(did, 'nonce'))
        } catch(err) {
            if (err instanceof ItemNotFoundError) {
                console.error('Nonce not found. DID may not be registered.')
            } else {
                console.error(err)
            }
            return
        }
    }

    async registerDID(email: string, did: string): Promise<any> {
        const nonce = 0
        const status = DIDStatus.Active
        const params: PutItemCommandInput = {
            TableName: this.name,
            Item: marshall({
                'PK':  did,
                'SK': did,
                'email': email,
                'nonce': nonce,
                'status': status,
                'created_at': Date.now(),
                'updated_at': Date.now(),
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

    async revokeDID(email: string, did: string, nonce: number): Promise<boolean> {
        const input: UpdateItemCommandInput = {
            TableName: this.name,
            Key: marshall({
                'PK': did,
                'SK': did
            }),
            UpdateExpression: `SET status=:status, nonce=${nonce}, updated_at=:updated_at`,
            ConditionExpression: '(attribute_exists(PK)) AND (email IN :email) AND NOT (status IN :status)',
            ExpressionAttributeValues: marshall({
                'email': email,
                'status': DIDStatus.Revoked,
                'updated_at': Date.now(),
            })
        }
        try {
            await this.client.send(new UpdateItemCommand(input))
            return true
        } catch(err) {
            if (err instanceof ConditionalCheckFailedException) {
                console.error('DID was not found or is already revoked.')
            } else {
                console.error(err)
            }
            return false
        }
    }

    _getItemAttribute = async (did: string, attribute: string): Promise<any> => {
        const params: GetItemCommandInput = {
            TableName: this.name,
            Key: marshall({
                'PK': did,
                'SK': did
            }),
        }
        const results = await this.client.send(new GetItemCommand(params));
        if (!results.Item) {
            throw new ItemNotFoundError('Item not found')
        }
        const data = unmarshall(results.Item || {})
        return data[attribute]
    }
}