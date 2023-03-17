import { SQSClient, ReceiveMessageCommand } from '@aws-sdk/client-sqs'
import { IQueueService } from './queue-service.type.js'
import type { Config } from 'node-config-ts'
import { ThrowDecoder } from '../../ancillary/throw-decoder.js'
import * as t from 'io-ts'

const REGION = 'REGION' //e.g. "us-east-1"
const sqsClient = new SQSClient({ region: REGION })
export { sqsClient }

export class SqsQueueService<A, O, I> implements IQueueService<A> {
  private readonly sqsClient: SQSClient
  private readonly sqsQueueUrl: string

  static inject = ['config'] as const

  constructor(config: Config, private readonly messageType: t.Type<A, O, I>) {
    // Set the AWS Region.
    this.sqsClient = new SQSClient({
      region: config.queue.awsRegion,
      endpoint: 'http://localhost:4566',
    })
    this.sqsQueueUrl = config.queue.sqsQueueUrl
  }

  async retrieveNextMessage(): Promise<A | undefined> {
    const output = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: this.sqsQueueUrl,
        AttributeNames: ['All'],
        MessageAttributeNames: ['All'],
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 10800, // 3h
        WaitTimeSeconds: 0,
      })
    )

    if (!output.Messages || output.Messages.length !== 1) {
      return undefined
    }

    if (!output.Messages[0]?.Body) {
      throw Error(`Unexpected message body retrieved from SQS at ${this.sqsQueueUrl}`)
    }

    const data = JSON.parse(output.Messages[0]?.Body)

    return ThrowDecoder.decode(this.messageType, data)
  }

  mark
}
