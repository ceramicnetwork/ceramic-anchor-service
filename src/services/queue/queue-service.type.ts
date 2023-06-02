export interface IQueueService<T> {
  retrieveNextMessage(): Promise<IQueueMessage<T> | undefined>
}

export interface IQueueMessage<T> {
  readonly data: T
  nack(): Promise<void>
  ack(): Promise<void>
}
