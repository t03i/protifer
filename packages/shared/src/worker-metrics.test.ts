import { afterEach, describe, expect, it } from 'vitest'

import {
  classifyTritonStatus,
  createWorkerMetrics,
  startMetricsServer,
} from './worker-metrics.ts'
import type { MetricsServerHandle } from './worker-metrics.ts'

describe('createWorkerMetrics', () => {
  it('registers the three histograms with expected names and labels', async () => {
    const metrics = createWorkerMetrics()
    metrics.tritonModelInferDuration.observe(
      { model: 'tmbed', status: 'success' },
      0.5,
    )
    metrics.predictionJobDuration.observe({ status: 'success' }, 1)
    metrics.embeddingJobDuration.observe({ status: 'failure' }, 2)

    const text = await metrics.registry.metrics()
    expect(text).toContain(
      'triton_model_infer_duration_seconds_bucket{le="1",model="tmbed",status="success"}',
    )
    expect(text).toContain(
      'prediction_job_duration_seconds_count{status="success"}',
    )
    expect(text).toContain(
      'embedding_job_duration_seconds_count{status="failure"}',
    )
  })

  it('isolates registries between instances', async () => {
    const a = createWorkerMetrics()
    const b = createWorkerMetrics()
    a.embeddingJobDuration.observe({ status: 'success' }, 1)
    const textA = await a.registry.metrics()
    const textB = await b.registry.metrics()
    expect(textA).toContain(
      'embedding_job_duration_seconds_count{status="success"} 1',
    )
    expect(textB).not.toContain('status="success"')
  })
})

describe('classifyTritonStatus', () => {
  it('maps known gRPC numeric codes to bounded labels', () => {
    expect(classifyTritonStatus({ code: 14 })).toBe('UNAVAILABLE')
    expect(classifyTritonStatus({ code: 4 })).toBe('DEADLINE_EXCEEDED')
  })

  it('falls back to INTERNAL for unknown or non-gRPC errors', () => {
    expect(classifyTritonStatus({ code: 999 })).toBe('INTERNAL')
    expect(classifyTritonStatus(new Error('boom'))).toBe('INTERNAL')
    expect(classifyTritonStatus('nope')).toBe('INTERNAL')
  })
})

describe('startMetricsServer', () => {
  let handle: MetricsServerHandle | undefined

  afterEach(async () => {
    await handle?.close()
    handle = undefined
  })

  it('serves Prometheus text on GET /metrics', async () => {
    const metrics = createWorkerMetrics()
    metrics.embeddingJobDuration.observe({ status: 'success' }, 1)
    handle = startMetricsServer({
      registry: metrics.registry,
      port: 19099,
      host: '127.0.0.1',
    })

    const res = await fetch('http://127.0.0.1:19099/metrics')
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(body).toContain('embedding_job_duration_seconds')
  })

  it('returns 404 for other paths', async () => {
    const metrics = createWorkerMetrics()
    handle = startMetricsServer({
      registry: metrics.registry,
      port: 19098,
      host: '127.0.0.1',
    })
    const res = await fetch('http://127.0.0.1:19098/healthz')
    await res.text()
    expect(res.status).toBe(404)
  })
})
