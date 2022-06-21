import 'reflect-metadata'
import { Config } from 'node-config-ts'
import { inject, singleton } from 'tsyringe'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'

export interface EventProducerService {
  /**
   * Emits an anchor event used to trigger an anchor
   */
  emitAnchorEvent(): Promise<void>
}

@singleton()
export class SQSEventProducerService implements EventProducerService {
  private readonly sqsClient: SQSClient
  constructor(@inject('config') private config?: Config) {
    this.sqsClient = new SQSClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    })
  }

  /**
   * Emits an anchor event by sending a message to the configured SQS
   */
  public async emitAnchorEvent(): Promise<void> {
    try {
      const data = await this.sqsClient.send(
        new SendMessageCommand({
          MessageAttributes: {
            Title: {
              DataType: 'String',
              StringValue: 'Anchor',
            },
          },
          MessageBody: 'A Steph test',
          MessageDeduplicationId: 'Steph1',
          MessageGroupId: 'StephsGroup',
          QueueUrl: 'https://sqs.us-east-2.amazonaws.com/967314784947/ceramic-ci-tnet.fifo',
        })
      )
    } catch (err) {
      console.log('Error', err)
    }
  }
}
