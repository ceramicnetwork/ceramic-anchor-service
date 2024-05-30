import {
  SQSClient,
  ReceiveMessageCommand,
  Message,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  SendMessageCommand,
  QueueAttributeName,
} from '@aws-sdk/client-sqs'
import AWSSDK from 'aws-sdk'
import LevelUp from 'levelup'
import S3LevelDOWN from 's3leveldown'
import { IpfsPubSubPublishQMessage, QueueMessageData } from '../../models/queue-message.js'
import {
  IQueueConsumerService,
  IQueueProducerService,
  IQueueMessage,
} from './queue-service.type.js'
import type { Config } from 'node-config-ts'
import { AnchorBatchQMessage, RequestQMessage } from '../../models/queue-message.js'
import { Codec, decode } from 'codeco'
import { AbortOptions } from '@ceramicnetwork/common'
import { logger } from '../../logger/index.js'
import * as http from 'http'
import { NodeHttpHandler } from '@smithy/node-http-handler'

const DEFAULT_MAX_TIME_TO_HOLD_MESSAGES_S = 21600
const DEFAULT_WAIT_TIME_FOR_MESSAGE_S = 10
const BATCH_STORE_PATH = '/cas/anchor/batch'

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

// This wrapper around SqsQueueMessage is used to handle the case where the list of batch request IDs is empty and must
// be fetched from S3. The underlying SqsQueueMessage remains the same (and is what is used for n/acking the message),
// but the data is updated to include the batch request IDs.
export class BatchQueueMessage implements IQueueMessage<AnchorBatchQMessage> {
  readonly data: AnchorBatchQMessage

  constructor(
    private readonly anchorBatchMessage: IQueueMessage<AnchorBatchQMessage>,
    batchJson: any
  ) {
    this.data = decode(AnchorBatchQMessage, batchJson)
  }

  async ack(): Promise<void> {
    await this.anchorBatchMessage.ack()
  }

  async nack(): Promise<void> {
    await this.anchorBatchMessage.nack()
  }
}

/**
 * Consumer and Producer for Sqs Queues
 */
export class SqsQueueService<TValue extends QueueMessageData>
  implements IQueueConsumerService<TValue>, IQueueProducerService<TValue>
{
  private readonly sqsClient: SQSClient
  private readonly maxTimeToHoldMessageSec: number
  private readonly waitTimeForMessageSec: number

  static inject = ['config'] as const

  constructor(
    config: Config,
    private readonly sqsQueueUrl: string,
    private readonly messageType: Codec<TValue, TValue>
  ) {
    const awsLogger = {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      info: () => {},
      error: (msg: any) => {
        logger.err(msg)
      },
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      debug: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      warn: () => {},
    }

    // Set the AWS Region.
    this.sqsClient = new SQSClient({
      region: config.queue.awsRegion,
      endpoint: this.sqsQueueUrl,
      logger: awsLogger,
      requestHandler: new NodeHttpHandler({
        httpAgent: new http.Agent({
          keepAlive: true,
          maxSockets: 1000,
          maxFreeSockets: 768,
        }),
      }),
    })
    this.maxTimeToHoldMessageSec =
      config.queue.maxTimeToHoldMessageSec || DEFAULT_MAX_TIME_TO_HOLD_MESSAGES_S
    this.waitTimeForMessageSec =
      config.queue.waitTimeForMessageSec || DEFAULT_WAIT_TIME_FOR_MESSAGE_S
  }

  /**
   * Consumes the next message off the queue
   * @returns One Sqs Queue Message
   */
  async receiveMessage(abortOptions?: AbortOptions): Promise<IQueueMessage<TValue> | undefined> {
    const receiveMessageCommandInput = {
      QueueUrl: this.sqsQueueUrl,
      AttributeNames: [QueueAttributeName.All],
      MessageAttributeNames: ['All'],
      MaxNumberOfMessages: 1,
      VisibilityTimeout: this.maxTimeToHoldMessageSec,
      WaitTimeSeconds: this.waitTimeForMessageSec,
    }

    const messages = await this.sqsClient
      .send(new ReceiveMessageCommand(receiveMessageCommandInput), {
        abortSignal: abortOptions?.signal,
      })
      .then((result) => result.Messages)
      .catch((err) => {
        throw new Error(`Failed to receive message from SQS queue ${this.sqsQueueUrl}: ${err}`)
      })

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
  async sendMessage(data: TValue, attempt = 0): Promise<void> {
    const sendMessageCommandInput = {
      QueueUrl: this.sqsQueueUrl,
      MessageBody: JSON.stringify(this.messageType.encode(data)),
    }

    await this.sqsClient.send(new SendMessageCommand(sendMessageCommandInput)).catch((err) => {
      if (err.message.includes('Signature expired') && attempt < 3) {
        logger.warn(
          `Received a signature expired error while sending message to SQS queue ${this.sqsQueueUrl} during attempt ${attempt}`
        )
        return this.sendMessage(data, attempt + 1)
      }

      throw new Error(`Failed to send message to SQS queue ${this.sqsQueueUrl}: ${err}`)
    })
  }
}

/**
 * ValidationSqsQueueService is used to publish request messages to the validation queue.
 * The validation queue will dedupe messages and add pass them to the batcher
 */
export class ValidationSqsQueueService extends SqsQueueService<RequestQMessage> {
  constructor(config: Config) {
    const queueUrl = config.queue.sqsQueueUrl + 'validate'
    super(config, queueUrl, RequestQMessage)
  }
}

/**
 * AnchorBatchSqsQueueService is used to consume and publish anchor batch messages. These batches are anchored by anchor workers
 */
export class AnchorBatchSqsQueueService extends SqsQueueService<AnchorBatchQMessage> {
  constructor(
    config: Config,
    private s3StorePath = config.queue.s3BucketName + BATCH_STORE_PATH,
    private s3Endpoint = config.queue.s3Endpoint ? config.queue.s3Endpoint : undefined,
    private _s3store?: LevelUp.LevelUp
  ) {
    const queueUrl = config.queue.sqsQueueUrl + 'batch'
    super(config, queueUrl, AnchorBatchQMessage)
  }

  /**
   * `new LevelUp` attempts to open a database, which leads to a request to AWS.
   * Let's make initialization lazy.
   */
  get s3store(): LevelUp.LevelUp {
    if (!this._s3store) {
      const levelDown = this.s3Endpoint
        ? new S3LevelDOWN(
            this.s3StorePath,
            new AWSSDK.S3({
              endpoint: this.s3Endpoint,
              s3ForcePathStyle: true,
            })
          )
        : new S3LevelDOWN(this.s3StorePath)

      this._s3store = new LevelUp(levelDown)
    }
    return this._s3store
  }

  override async receiveMessage(
    abortOptions?: AbortOptions
  ): Promise<IQueueMessage<AnchorBatchQMessage> | undefined> {
    const anchorBatchMessage: IQueueMessage<AnchorBatchQMessage> | undefined =
      await super.receiveMessage(abortOptions)
    // If the list of batch request IDs is empty, we need to fetch the full batch from S3.
    if (anchorBatchMessage && anchorBatchMessage.data.rids.length === 0) {
      try {
        const batchJson = await this.s3store.get(anchorBatchMessage.data.bid)
        return new BatchQueueMessage(anchorBatchMessage, JSON.parse(batchJson))
      } catch (err: any) {
        throw Error(`Error retrieving batch ${anchorBatchMessage.data.bid} from S3: ${err.message}`)
      }
    }
    return anchorBatchMessage
  }
}

/**
 * FailureSqsQueueService is used to consume and publish any failures that could happen during anchoring by the anchor workers.
 * ex. A batch was partially completed so we can publish the partially complete batch to the failure queue.
 * The failure queue can then handle it accordingly (such as putting the failed requests into a new batch) and provide alerts.
 */
export class FailureSqsQueueService extends SqsQueueService<QueueMessageData> {
  constructor(config: Config) {
    const queueUrl = config.queue.sqsQueueUrl + 'failure'
    super(config, queueUrl, QueueMessageData)
  }
}

export class IpfsQueueService extends SqsQueueService<IpfsPubSubPublishQMessage> {
  constructor(config: Config) {
    const queueUrl = config.queue.sqsQueueUrl + 'ipfs'
    super(config, queueUrl, IpfsPubSubPublishQMessage)
  }
}
