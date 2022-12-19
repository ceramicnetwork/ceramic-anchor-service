import { DynamoDB } from "../utils/dynamodb.js"

const createTableIfNotExists = false
const db = new DynamoDB(createTableIfNotExists)

export const handler = async (event, context) => {
    console.log(event)
// VAL: check if nonce has already been used. if so, discard
}
