import 'reflect-metadata'
import 'dotenv/config'
import { container } from 'tsyringe'
import { config } from 'node-config-ts'
import { EventProducerService } from '../event-producer/event-producer-service.js'
import { HTTPEventProducerService } from '../event-producer/http/http-event-producer-service.js'
import { jest } from '@jest/globals'

describe('http event service', () => {
  beforeAll(async () => {
    container.registerInstance('config', config)
    container.registerSingleton('eventProducerService', HTTPEventProducerService)
  })

  afterAll(() => {
    container.resolve<EventProducerService>('eventProducerService').destroy()
  })

  test('Can submit an anchor event', async () => {
    const eventProducerService = container.resolve<EventProducerService>('eventProducerService')

    type MockedEmitAnchorEvent = (body: string) => Promise<void>;
    (eventProducerService.emitAnchorEvent as MockedEmitAnchorEvent) = jest.fn(async (body: string) => {
      function fetchTypeCheck(input: RequestInfo | URL, init?: RequestInit | undefined): Promise<Response> {
        return new Promise(r => setTimeout(r, 500))
      }
      await fetchTypeCheck(config.anchorLauncherUrl)
    })

    await eventProducerService.emitAnchorEvent('test')
  })
})
