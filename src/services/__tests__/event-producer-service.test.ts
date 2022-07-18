import 'reflect-metadata'
import 'dotenv/config'
import { container } from 'tsyringe'
import { config } from 'node-config-ts'
import { EventProducerService } from '../event-producer/event-producer-service.js'
import { SQSEventProducerService } from '../event-producer/sqs/sqs-event-producer-service.js'

// TODO: Use local stack instead of an actual AWS SQS Queue
// https://linear.app/3boxlabs/issue/NET-1633/use-localstack-instead-of-an-aws-sqs-queue-in-cas-tests
describe('event service', () => {
  beforeAll(async () => {
    container.registerInstance('config', config)
    container.registerSingleton('eventProducerService', SQSEventProducerService)
  })

  afterAll(() => {
    container.resolve<EventProducerService>('eventProducerService').destroy()
  })

  test('Can submit an anchor event', async () => {
    const eventProducerService = container.resolve<EventProducerService>('eventProducerService')
    await eventProducerService.emitAnchorEvent('test')
  })
})
