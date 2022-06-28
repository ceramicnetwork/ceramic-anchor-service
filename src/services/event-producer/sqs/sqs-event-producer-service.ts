import 'reflect-metadata'
import { Config } from 'node-config-ts'
import { inject, singleton } from 'tsyringe'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { EventProducerService } from '../event-producer-service.js'
import { v4 as uuidv4 } from 'uuid'

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
        MessageBody: uuidv4(),
        MessageGroupId: 'anchor',
        QueueUrl: process.env.AWS_QUEUE_URL,
      })
    )
  }

  /**
   * Destroy underlying resources
   */
  public destroy(): void {
    this.sqsClient.destroy()
  }
}
