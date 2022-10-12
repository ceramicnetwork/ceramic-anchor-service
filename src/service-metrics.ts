/* Service metrics need to push to a collector rather than expose
   metrics on an exporter */

import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { BasicTracerProvider, TraceIdRatioBasedSampler,
         ParentBasedSampler, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import {trace} from '@opentelemetry/api'

import { Utils } from './utils.js'

export const UNKNOWN_CALLER = 'Unknown'

export const CONCURRENCY_LIMIT = 1
export const TRACE_CONCURRENCY_LIMIT = 1
export const DEFAULT_TRACE_SAMPLE_RATIO = 0.1

class _ServiceMetrics {
  protected caller
  protected collectorURL
  protected traceCollectorURL
  protected readonly counters
  protected readonly histograms
  protected meterProvider: MeterProvider
  protected metricExporter: OTLPMetricExporter
  protected traceExporter: OTLPTraceExporter
  protected meter
  constructor() {
    this.caller = ''
    this.collectorURL = ''
    this.traceCollectorURL = ''
    this.counters = {}
    this.histograms = {}
    this.meter = null
    this.meterProvider = null
  }

  /* Set up the exporter at run time, after we have read the configuration */
  start(collectorHost = '',
        caller: string = UNKNOWN_CALLER,
        sample_ratio: number = DEFAULT_TRACE_SAMPLE_RATIO) {

    this.caller = caller
    this.meterProvider = new MeterProvider({})

    if (collectorHost) {
      this.collectorURL = `http://${collectorHost}:4318/v1/metrics`
      this.traceCollectorURL = `http://${collectorHost}:4318/v1/traces`

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

      // now set up trace exporter
      this.traceExporter = new OTLPTraceExporter( {
          url: this.traceCollectorURL,
          concurrencyLimit: TRACE_CONCURRENCY_LIMIT
      })

      //https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-sdk-trace-base
      const tracerProvider = new BasicTracerProvider({

        sampler: new ParentBasedSampler({
          // sample_ratio represents the percentage of traces which should
          // be sampled.
          root: new TraceIdRatioBasedSampler(sample_ratio)
        })
      })
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

  recordAverage(name: string, arr: number[]) {
    // if array is empty, just return
    if (arr.length <= 0) {
       return
    }
    this.record(name, Utils.averageArray(arr))
  }
}

export const ServiceMetrics = new _ServiceMetrics()
