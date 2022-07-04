import 'reflect-metadata'
import { Config } from 'node-config-ts'
import { inject, singleton } from 'tsyringe'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { EventProducerService } from '../event-producer-service.js'

@singleton()
export class SQSEventProducerService implements EventProducerService {
  private readonly sqsClient: SQSClient
  constructor(@inject('config') private config?: Config) {
    this.sqsClient = new SQSClient({})
  }

  /**
   * Emits an anchor event by sending a message to the configured SQS
   */
  public async emitAnchorEvent(body: string): Promise<void> {
    await this.sqsClient.send(
      new SendMessageCommand({
        MessageBody: body,
        MessageGroupId: 'anchor',
        QueueUrl: this.config.awsSqsUrl,
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
