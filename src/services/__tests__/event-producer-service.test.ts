import 'reflect-metadata'
import { container } from 'tsyringe'
import { config } from 'node-config-ts'
import { EventProducerService, SQSEventProducerService } from '../event-producer-service.js'

describe('event service', () => {
  beforeAll(async () => {
    container.registerInstance('config', config)
    container.registerSingleton('eventProducerService', SQSEventProducerService)
  })

  test('stuff', async () => {
    const eventProducerService = container.resolve<EventProducerService>('eventProducerService')
    // await eventProducerService.emitAnchorEvent()
  })
})
