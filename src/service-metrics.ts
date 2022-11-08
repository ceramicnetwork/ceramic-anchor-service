/* Service metrics need to push to a collector rather than expose
   metrics on an exporter */

import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import {
  BasicTracerProvider,
  TraceIdRatioBasedSampler,
  ParentBasedSampler,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'
import { Resource } from '@opentelemetry/resources'
import { trace } from '@opentelemetry/api'

import { Utils } from './utils.js'
import { TimeInput } from '@opentelemetry/api/build/src/common/Time'

export const UNKNOWN_CALLER = 'Unknown'

export const CONCURRENCY_LIMIT = 1
export const TRACE_CONCURRENCY_LIMIT = 1
export const DEFAULT_TRACE_SAMPLE_RATIO = 0.1

enum LOG_LEVEL {
  debug,
  info,
  warn,
  imp,
  error,
}

class _NullLogger {
  debug(msg) {}
  info(msg) {}
  imp(msg) {}
  warn(msg) {}
  err(msg) {}
}

interface Endable {
  end(endTime?: TimeInput): void
}

interface Timeable {
  createdAt: Date
  updatedAt: Date
}

class NullSpan implements Endable {
  // if we start using other span methods, add null methods here

  // Returns the flag whether this span will be recorded.
  end(endTime?: TimeInput) {
    return false
  }
}

export enum SinceField {
  CREATED_AT = 0,
  UPDATED_AT = 1
}

export class TimeableMetric {
  protected cnt: number
  protected totTime: number
  protected maxTime: number
  protected since: SinceField

  constructor(since:SinceField) {
    this.cnt = 0
    this.totTime = 0
    this.maxTime = 0
    this.since = since
  } 

  public recordAll(requests: Timeable[]) {
     for (const req of requests) {
       this.record(req)
     }
  }

  public record(request: Timeable) {

    this.cnt += 1
    let timeElapsed = 0
    if (this.since === SinceField.CREATED_AT) {
      timeElapsed = Date.now() - request.createdAt.getTime()
    } else { // UpdatedAt
      timeElapsed = Date.now() - request.updatedAt.getTime()
    }
    this.totTime += timeElapsed
    if (timeElapsed > this.maxTime) {
      this.maxTime = timeElapsed
    }
  }

  private getMeanTime(): number {
    return this.totTime/this.cnt
  }

  public publishStats(name:string): void {
    ServiceMetrics.count(name + '_total', this.cnt)
    ServiceMetrics.record(name + '_mean', this.getMeanTime())
    ServiceMetrics.record(name + '_max', this.maxTime)
  }

}


class _ServiceMetrics {
  protected caller
  protected readonly counters
  protected readonly gauges
  protected readonly histograms
  protected meter
  protected tracer
  protected logger
  constructor() {
    this.caller = ''
    this.counters = {}
    this.gauges = {}
    this.histograms = {}
    this.meter = null
    this.tracer = null
    this.logger = null
  }

  /* Set up the exporter at run time, after we have read the configuration */
  start(
    collectorHost = '',
    caller: string = UNKNOWN_CALLER,
    sample_ratio: number = DEFAULT_TRACE_SAMPLE_RATIO,
    logger: any = null
  ) {
    this.caller = caller
    const meterProvider = new MeterProvider({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: caller,
      }),
    })

    if (!collectorHost) {
      // If no collector URL then the functions will be no-ops
      return
    }
    const collectorURL = `http://${collectorHost}:4318/v1/metrics`
    const traceCollectorURL = `http://${collectorHost}:4318/v1/traces`

    const metricExporter = new OTLPMetricExporter({
      url: collectorURL,
      concurrencyLimit: CONCURRENCY_LIMIT,
    })
    meterProvider.addMetricReader(
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 1000,
      })
    )

    // Meter for calling application
    this.meter = meterProvider.getMeter(caller)

    // now set up trace exporter
    const traceExporter = new OTLPTraceExporter({
      url: traceCollectorURL,
      concurrencyLimit: TRACE_CONCURRENCY_LIMIT,
    })

    //reference: https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-sdk-trace-base
    const traceProvider = new BasicTracerProvider({
      sampler: new ParentBasedSampler({
        // sample_ratio represents the percentage of traces which should
        // be sampled.
        root: new TraceIdRatioBasedSampler(sample_ratio),
      }),
    })

    traceProvider.addSpanProcessor(new BatchSpanProcessor(traceExporter))
    traceProvider.register()

    // set up a tracer for the caller
    this.tracer = trace.getTracer(caller)

    // accept a logger from the caller
    this.logger = logger || new _NullLogger()
  }

  // could have subclasses or specific functions with set params, but we want to
  // easily and quickly change what is recorded, there are no code dependencies on it

  startSpan(name: string, params?: any): Endable {
    if (!this.tracer) {
      return new NullSpan()
    }

    try {
      const span = this.tracer.startSpan(name)
      for (const key in params) {
        span.setAttribute(key, params[key])
      }
      return span
    } catch (e) {
      this.logger.warn(`Error starting span ${name}: ${e}`)
      return new NullSpan()
    }
  }

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

  observe(name: string, value: number, params?: any) {
    // If not initialized, just return
    if (!this.meter) {
      return
    }
    // Create this Gauge if we have not already
    if (!(name in this.gauges)) {
      this.gauges[name] = this.meter.createObservableGauge(`${this.caller}:${name}`)
    }
    // Record the observed value
    this.gauges[name].observe(value, params)
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
