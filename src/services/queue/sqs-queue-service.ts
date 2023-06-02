import {
  SQSClient,
  ReceiveMessageCommand,
  Message,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from '@aws-sdk/client-sqs'
import { IQueueService, IQueueMessage } from './queue-service.type.js'
import type { Config } from 'node-config-ts'
import { decode, Decoder } from 'codeco'
import { defer, retry, first, repeat, firstValueFrom } from 'rxjs'
import { AnchorBatch } from '../../models/queue-message.js'

export class SqsQueueMessage<TInput, TValue> implements IQueueMessage<TValue> {
  readonly data: TValue

  constructor(
    private readonly sqsClient: SQSClient,
    private readonly sqsQueueUrl: string,
    private readonly messageType: Decoder<TInput, TValue>,
    private readonly message: Message
  ) {
    if (!this.message.Body) {
      throw Error(`Unexpected message body retrieved from SQS at ${this.sqsQueueUrl}`)
    }

    const jsonData = JSON.parse(this.message.Body)
    this.data = decode(this.messageType, jsonData)
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

export class SqsQueueService<TInput, TValue> implements IQueueService<TValue> {
  private readonly sqsClient: SQSClient
  private readonly sqsQueueUrl: string
  private readonly usePolling: boolean
  private readonly maxTimeToHoldMessageSec: number
  private readonly waitTimeForMessageSec: number

  static inject = ['config'] as const

  constructor(config: Config, private readonly messageType: Decoder<TInput, TValue>) {
    // Set the AWS Region.
    this.sqsClient = new SQSClient({
      region: config.queue.awsRegion,
      endpoint: config.queue.sqsQueueUrl,
    })
    this.sqsQueueUrl = config.queue.sqsQueueUrl
    this.usePolling = config.queue.usePolling
    this.maxTimeToHoldMessageSec = config.queue.maxTimeToHoldMessageSec
    this.waitTimeForMessageSec = config.queue.waitTimeForMessageSec
  }

  async retrieveNextMessage(): Promise<IQueueMessage<TValue> | undefined> {
    const receiveMessageCommandInput = {
      QueueUrl: this.sqsQueueUrl,
      AttributeNames: ['All'],
      MessageAttributeNames: ['All'],
      MaxNumberOfMessages: 1,
      VisibilityTimeout: this.maxTimeToHoldMessageSec,
      WaitTimeSeconds: this.waitTimeForMessageSec,
    }

    let output
    if (this.usePolling) {
      output = await firstValueFrom(
        defer(() =>
          this.sqsClient.send(new ReceiveMessageCommand(receiveMessageCommandInput))
        ).pipe(
          repeat({ delay: 1000 }),
          retry({ delay: 1000 }),
          first((result) => Boolean(result.Messages))
        )
      )
    } else {
      output = await this.sqsClient.send(new ReceiveMessageCommand(receiveMessageCommandInput))
    }

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

export class AnchorBatchSqsQueueService<TInput> extends SqsQueueService<TInput, AnchorBatch> {
  constructor(config: Config) {
    super(config, AnchorBatch)
  }
}
