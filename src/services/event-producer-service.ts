import 'reflect-metadata'
import { Config } from 'node-config-ts'
import { inject, singleton } from 'tsyringe'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'

export interface EventProducerService {
  /**
   * Emits an anchor event used to trigger an anchor
   */
  emitAnchorEvent(): Promise<void>
  destroy(): void
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
    await this.sqsClient.send(
      new SendMessageCommand({
        MessageBody: new Date().toString(), // change to date (uuid)
        MessageGroupId: 'anchor',
        QueueUrl: process.env.AWS_QUEUE_URL,
      })
    )
  }

  public destroy(): void {
    this.sqsClient.destroy()
  }
}
