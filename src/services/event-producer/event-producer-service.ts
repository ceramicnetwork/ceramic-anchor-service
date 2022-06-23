import 'reflect-metadata'
import { Config } from 'node-config-ts'
import { inject, singleton } from 'tsyringe'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'

export interface EventProducerService {
  /**
   * Emits an anchor event used to trigger an anchor
   */
  emitAnchorEvent(): Promise<void>
  /**
   * Destroy underlying resources
   */
  destroy(): void
}
