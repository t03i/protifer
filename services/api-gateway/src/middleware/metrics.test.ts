import { OpenAPIHono } from '@hono/zod-openapi'
import { Registry, Counter, Histogram, Gauge } from 'prom-client'
import { describe, it, expect, beforeEach } from 'vitest'

import type { AppMetrics } from '../metrics.ts'
import { createMetricsMiddleware } from './metrics.ts'

function makeRegistry() {
  return new Registry()
}

function makeMetrics(registry: Registry): AppMetrics {
  return {
    reconciled: new Counter({
      name: 'job_cleanup_reconciled_total',
      help: 'test',
      labelNames: ['reason'] as const,
      registers: [registry],
    }),
    sweeps: new Counter({
      name: 'job_cleanup_sweeps_total',
      help: 'test',
      labelNames: ['outcome'] as const,
      registers: [registry],
    }),
    sweepDuration: new Histogram({
      name: 'job_cleanup_sweep_duration_seconds',
      help: 'test',
      registers: [registry],
    }),
    httpRequestsTotal: new Counter({
      name: 'http_requests_total',
      help: 'test',
      labelNames: ['method', 'route', 'status'] as const,
      registers: [registry],
    }),
    httpRequestDuration: new Histogram({
      name: 'http_request_duration_seconds',
      help: 'test',
      labelNames: ['method', 'route', 'status'] as const,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    }),
    bullmqQueueJobs: new Gauge({
      name: 'bullmq_queue_jobs',
      help: 'test',
      labelNames: ['queue', 'state'] as const,
      registers: [registry],
    }),
    registry,
  }
}

describe('createMetricsMiddleware', () => {
  let registry: Registry
  let metrics: AppMetrics

  beforeEach(() => {
    registry = makeRegistry()
    metrics = makeMetrics(registry)
  })

  it('increments http_requests_total after a successful request', async () => {
    const app = new OpenAPIHono()
    app.use('*', createMetricsMiddleware(metrics))
    app.get('/ping', (c) => c.json({ ok: true }))

    await app.request('/ping')

    const raw = await registry.getSingleMetricAsString('http_requests_total')
    expect(raw).toContain('method="GET"')
    expect(raw).toContain('status="200"')
    expect(raw).toMatch(/http_requests_total{[^}]+} 1/)
  })

  it('records http_request_duration_seconds histogram with at least one bucket', async () => {
    const app = new OpenAPIHono()
    app.use('*', createMetricsMiddleware(metrics))
    app.get('/ping', (c) => c.json({ ok: true }))

    await app.request('/ping')

    const raw = await registry.getSingleMetricAsString(
      'http_request_duration_seconds',
    )
    expect(raw).toContain('http_request_duration_seconds_bucket')
    expect(raw).toContain('method="GET"')
    expect(raw).toContain('status="200"')
  })

  it('uses the matched route pattern, not the raw URL', async () => {
    const app = new OpenAPIHono()
    app.use('*', createMetricsMiddleware(metrics))
    app.get('/items/:id', (c) => c.json({ id: c.req.param('id') }))

    await app.request('/items/abc-123')

    const raw = await registry.getSingleMetricAsString('http_requests_total')
    expect(raw).toContain('route="/items/:id"')
    expect(raw).not.toContain('route="/items/abc-123"')
  })

  it('records 4xx status for not-found requests', async () => {
    const app = new OpenAPIHono()
    app.use('*', createMetricsMiddleware(metrics))

    await app.request('/does-not-exist')

    const raw = await registry.getSingleMetricAsString('http_requests_total')
    expect(raw).toContain('status="404"')
  })

  it('counts multiple requests independently', async () => {
    const app = new OpenAPIHono()
    app.use('*', createMetricsMiddleware(metrics))
    app.get('/ping', (c) => c.json({ ok: true }))

    await app.request('/ping')
    await app.request('/ping')
    await app.request('/ping')

    const raw = await registry.getSingleMetricAsString('http_requests_total')
    expect(raw).toMatch(/http_requests_total{[^}]+} 3/)
  })
})
