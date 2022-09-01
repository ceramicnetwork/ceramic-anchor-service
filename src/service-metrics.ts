/* Service metrics need to push to a collector rather than expose
   metrics on an exporter */

import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'

// Metric names apply to both services and api endpoint
// the parameters will be used to distinguish the endpoint, type of call etc
import { METRIC_NAMES } from './settings.js'

export const UNKNOWN_CALLER = 'Unknown'

export const CONCURRENCY_LIMIT = 1

class _ServiceMetrics {
  protected caller
  protected collectorURL
  protected readonly counters
  protected readonly histograms
  protected meterProvider: MeterProvider
  protected metricExporter: OTLPMetricExporter
  protected meter
  constructor() {
    this.caller = ''
    this.collectorURL = ''
    this.counters = {}
    this.histograms = {}
    this.meter = null
    this.meterProvider = null
  }

  /* Set up the exporter at run time, after we have read the configuration */
  start(collectorHost: string = '', caller: string = UNKNOWN_CALLER) {


    this.caller = caller
    this.meterProvider = new MeterProvider({})

    if (collectorHost) {
      this.collectorURL = `http://${collectorHost}:4318/v1/metrics`
      this.metricExporter = new OTLPMetricExporter({
           url: this.collectorURL,
           concurrencyLimit: CONCURRENCY_LIMIT
      })
      this.meterProvider.addMetricReader(new PeriodicExportingMetricReader({
           exporter: this.metricExporter,
           exportIntervalMillis: 1000
      }))

      // Meter for calling application
      this.meter = this.meterProvider.getMeter(caller)
    }
    // If no collector URL then the functions will be no-ops
  }

  // could have subclasses or specific functions with set params, but we want to
  // easily and quickly change what is recorded, there are no code dependencies on it

  count(name: string, value: number, params?: any) {
    // If not initialized, just return

    if (!this.meter) {
      return
    }
    // Create this counter if we have not already
    if (!(name in this.counters)) {
      this.counters[name] = this.meter.createCounter(`${this.caller}:${name}`)
    }
    // Add to the count
    this.counters[name].add(value, params)
  }

  record(name: string, value: number, params?: any) {
    // If not initialized, just return
    if (!this.meter) {
      return
    }
    // Create this Histogram if we have not already
    if (!(name in this.histograms)) {
      this.histograms[name] = this.meter.createHistogram(`${this.caller}:${name}`)
    }
    // Record the observed value
    this.histograms[name].record(value, params)
  }
}

export const ServiceMetrics = new _ServiceMetrics()
