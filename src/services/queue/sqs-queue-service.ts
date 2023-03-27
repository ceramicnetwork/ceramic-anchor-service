import {
  SQSClient,
  ReceiveMessageCommand,
  Message,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from '@aws-sdk/client-sqs'
import { IQueueService, IQueueMessage } from './queue-service.type.js'
import type { Config } from 'node-config-ts'
import { ThrowDecoder } from '../../ancillary/throw-decoder.js'
import * as t from 'io-ts'

export class SqsQueueMessage<A, O, I> implements IQueueMessage<A> {
  readonly data: A

  constructor(
    private readonly sqsClient: SQSClient,
    private readonly sqsQueueUrl: string,
    private readonly messageType: t.Type<A, O, I>,
    private readonly message: Message
  ) {
    if (!this.message.Body) {
      throw Error(`Unexpected message body retrieved from SQS at ${this.sqsQueueUrl}`)
    }

    const jsonData = JSON.parse(this.message.Body)
    this.data = ThrowDecoder.decode(this.messageType, jsonData)
  }

  async ack(): Promise<void> {
    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: this.sqsQueueUrl,
        ReceiptHandle: this.message.ReceiptHandle,
      })
    )
  }

  async nack(): Promise<void> {
    await this.sqsClient.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.sqsQueueUrl,
        ReceiptHandle: this.message.ReceiptHandle,
        VisibilityTimeout: 0,
      })
    )
  }
}

export class SqsQueueService<A, O, I> implements IQueueService<A> {
  private readonly sqsClient: SQSClient
  private readonly sqsQueueUrl: string

  static inject = ['config'] as const

  constructor(config: Config, private readonly messageType: t.Type<A, O, I>) {
    // Set the AWS Region.
    this.sqsClient = new SQSClient({
      region: config.queue.awsRegion,
      endpoint: config.queue.sqsQueueUrl,
    })
    this.sqsQueueUrl = config.queue.sqsQueueUrl
  }

  async retrieveNextMessage(): Promise<IQueueMessage<A> | undefined> {
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

    return new SqsQueueMessage(
      this.sqsClient,
      this.sqsQueueUrl,
      this.messageType,
      output.Messages[0] as Message
    )
  }
}
