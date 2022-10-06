import { ServiceMetrics } from '../service-metrics.js'
import { config } from 'node-config-ts'

describe('simple test of metrics', () => {
  beforeAll(async () => {
    ServiceMetrics.start(config.metrics.collectorHost, 'cas-test-' + config.mode)
  })
  test('create metric', async () => {
    ServiceMetrics.count('test_metric', 1, {
      anyparam: null,
      otherparam: 'atring',
      intparam: 2,
    })
    ServiceMetrics.record('test_metric', 1, {
      anyparam: null,
      otherparam: 'atring',
      intparam: 2,
    })
  })
  test('create metric and add values', async () => {
    ServiceMetrics.count('test_metric', 1, {
      anyparam: null,
      otherparam: 'atring',
      intparam: 2,
    })
    ServiceMetrics.count('test_metric', 3, {
      anyparam: null,
      otherparam: 'atring',
      intparam: 2,
    })
    ServiceMetrics.count('test_metric', 5, { newparam: 8 })
    ServiceMetrics.record('test_metric', 1, {
      anyparam: null,
      otherparam: 'atring',
      intparam: 2,
    })
    ServiceMetrics.record('test_metric', 3, {
      anyparam: null,
      otherparam: 'atring',
      intparam: 2,
    })
    ServiceMetrics.record('test_metric', 5, { newparam: 9 })
  })
})
