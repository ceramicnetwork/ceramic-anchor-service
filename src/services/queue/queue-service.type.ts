import { AbortOptions } from '@ceramicnetwork/common'
import { QueueMessageData } from '../../models/queue-message.js'

/**
 * Queue consumer interface
 */
export interface IQueueConsumerService<T extends QueueMessageData> {
  receiveMessage(abortOptions?: AbortOptions): Promise<IQueueMessage<T> | undefined>
}

/**
 * Queue producer interface
 */
export interface IQueueProducerService<T extends QueueMessageData> {
  sendMessage(message: T, attempt?: number): Promise<void>
}

/**
 * Queue message allowing you to ack or nack the message
 */
export interface IQueueMessage<T extends QueueMessageData> {
  readonly data: T
  nack(): Promise<void>
  ack(): Promise<void>
}
