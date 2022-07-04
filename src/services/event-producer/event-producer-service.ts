import 'reflect-metadata'
export interface EventProducerService {
  /**
   * Emits an anchor event used to trigger an anchor
   */
  emitAnchorEvent(body: string): Promise<void>
  /**
   * Destroy underlying resources
   */
  destroy(): void
}
