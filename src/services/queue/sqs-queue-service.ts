import {
  SQSClient,
  ReceiveMessageCommand,
  Message,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs'
import { QueueMessageData } from '../../models/queue-message.js'
import {
  IQueueConsumerService,
  IQueueProducerService,
  IQueueMessage,
} from './queue-service.type.js'
import type { Config } from 'node-config-ts'
import { AnchorBatch } from '../../models/queue-message.js'
import { Codec, decode } from 'codeco'
import { AbortOptions } from '@ceramicnetwork/common'
import { Utils } from '../../utils.js'

/**
 * Sqs Queue Message received by consumers.
 * Once the message is done processing you can either "ack" the message (remove the message from the queue) or "nack" the message (put the message back on the queue)
 */
export class SqsQueueMessage<TValue extends QueueMessageData> implements IQueueMessage<TValue> {
  readonly data: TValue

  constructor(
    private readonly sqsClient: SQSClient,
    private readonly sqsQueueUrl: string,
    private readonly messageType: Codec<TValue, TValue>,
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

/**
 * Consumer and Producer for Sqs Queues
 */
export class SqsQueueService<TValue extends QueueMessageData>
  implements IQueueConsumerService<TValue>, IQueueProducerService<TValue>
{
  private readonly sqsClient: SQSClient
  private readonly pollingIntervalMS: number
  private readonly maxTimeToHoldMessageSec: number
  private readonly waitTimeForMessageSec: number

  static inject = ['config'] as const

  constructor(
    config: Config,
    private readonly sqsQueueUrl: string,
    private readonly messageType: Codec<TValue, TValue>
  ) {
    // Set the AWS Region.
    this.sqsClient = new SQSClient({
      region: config.queue.awsRegion,
      endpoint: this.sqsQueueUrl,
    })
    this.pollingIntervalMS = config.queue.pollingIntervalMS
    this.maxTimeToHoldMessageSec = config.queue.maxTimeToHoldMessageSec
    this.waitTimeForMessageSec = config.queue.waitTimeForMessageSec
  }

  /**
   * Consumes the next message off the queue
   * @returns One Sqs Queue Message
   */
  async receiveMessage(abortOptions?: AbortOptions): Promise<IQueueMessage<TValue> | undefined> {
    const receiveMessageCommandInput = {
      QueueUrl: this.sqsQueueUrl,
      AttributeNames: ['All'],
      MessageAttributeNames: ['All'],
      MaxNumberOfMessages: 1,
      VisibilityTimeout: this.maxTimeToHoldMessageSec,
      WaitTimeSeconds: this.waitTimeForMessageSec,
    }

    const messages = await Utils.poll(
      () => {
        return this.sqsClient
          .send(new ReceiveMessageCommand(receiveMessageCommandInput), {
            abortSignal: abortOptions?.signal,
          })
          .then((result) => result.Messages)
      },
      this.pollingIntervalMS,
      abortOptions
    )

    if (!messages || messages.length !== 1) {
      return undefined
    }

    return new SqsQueueMessage(
      this.sqsClient,
      this.sqsQueueUrl,
      this.messageType,
      messages[0] as Message
    )
  }

  /**
   * Publishes a message to a sqs queue
   * @param data the data you want to publish
   */
  async sendMessage(data: TValue): Promise<void> {
    const sendMessageCommandInput = {
      QueueUrl: this.sqsQueueUrl,
      MessageBody: JSON.stringify(this.messageType.encode(data)),
    }

    await this.sqsClient.send(new SendMessageCommand(sendMessageCommandInput))
  }
}

/**
 * AnchorBatchSqsQueueService is used to consume and publish anchor batch messages. These batches are anchored by anchor workers
 */
export class AnchorBatchSqsQueueService extends SqsQueueService<AnchorBatch> {
  constructor(config: Config) {
    super(config, config.queue.sqsBatchQueueUrl, AnchorBatch)
  }
}

/**
 * FailureSqsQueueService is used to consume and publish any failures that could happen during anchoring by the anchor workers.
 * ex. A batch was partially completed so we can publish the partially complete batch to the failure queue.
 * The failure queue can then handle it accordingly (such as putting the failed requests into a new batch) and provide alerts.
 */
export class FailureSqsQueueService extends SqsQueueService<QueueMessageData> {
  constructor(config: Config) {
    super(config, config.queue.sqsFailureQueueUrl, QueueMessageData)
  }
}
