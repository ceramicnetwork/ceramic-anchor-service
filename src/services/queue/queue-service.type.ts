export interface IQueueService<T> {
  retrieveNextMessage(): Promise<T | undefined>
}
