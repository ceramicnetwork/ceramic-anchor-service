import type { EventProducerService } from '../event-producer/event-producer-service.js'

export class MockEventProducerService implements EventProducerService {
  async emitAnchorEvent(): Promise<void> {
    // Do Nothing
  }
}
