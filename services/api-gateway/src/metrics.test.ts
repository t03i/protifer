import { Gauge, Registry } from 'prom-client'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  createMetrics,
  startQueueDepthPolling,
  startSheddingStatePolling,
} from './metrics.ts'

describe('createMetrics', () => {
  it('returns a registry with all expected metrics', () => {
    const m = createMetrics()
    const names = m.registry.getMetricsAsArray().map((v) => v.name)
    expect(names).toContain('job_cleanup_reconciled_total')
    expect(names).toContain('job_cleanup_sweeps_total')
    expect(names).toContain('job_cleanup_sweep_duration_seconds')
    expect(names).toContain('http_requests_total')
    expect(names).toContain('http_request_duration_seconds')
    expect(names).toContain('bullmq_queue_jobs')
    expect(names).toContain('requests_shed_total')
    expect(names).toContain('shedding_residues_per_second')
    expect(names).toContain('shedding_pending_residues')
    expect(names).toContain('shedding_estimated_wait_seconds')
    expect(names).toContain('bullmq_job_wait_duration_seconds')
    expect(names).toContain('bullmq_job_processing_duration_seconds')
    expect(names).toContain('bullmq_job_total_duration_seconds')
    expect(names).toContain('bullmq_job_failures_total')
    expect(names).toContain('bullmq_job_retries_total')
    expect(names).toContain('bullmq_job_attempts')
    expect(names).toContain('bullmq_stalled_total')
    expect(names).toContain('bullmq_stale_children_jobs')
    expect(names).toContain('bullmq_stale_children_oldest_seconds')
  })

  it('registry.metrics() returns text/plain prometheus format', async () => {
    const m = createMetrics()
    const text = await m.registry.metrics()
    expect(text).toContain('# HELP http_requests_total')
    expect(text).toContain('# HELP bullmq_queue_jobs')
  })
})

describe('startQueueDepthPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('polls queues on each interval tick and sets gauge values', async () => {
    const registry = new Registry()
    const gauge = new Gauge({
      name: 'bullmq_queue_jobs',
      help: 'test',
      labelNames: ['queue', 'state'] as const,
      registers: [registry],
    })

    const getJobCounts = vi.fn().mockResolvedValue({
      waiting: 3,
      active: 1,
      delayed: 0,
      failed: 2,
      completed: 10,
      'waiting-children': 4,
    })
    const mockQueue = { name: 'embedding', getJobCounts } as never

    const { stop } = startQueueDepthPolling([mockQueue], gauge, 15_000)

    // Advance one interval
    await vi.advanceTimersByTimeAsync(15_000)
    expect(getJobCounts).toHaveBeenCalledOnce()
    expect(getJobCounts).toHaveBeenCalledWith(
      'waiting',
      'active',
      'delayed',
      'failed',
      'completed',
      'waiting-children',
    )
    const metric = await gauge.get()
    const waitingChildren = metric.values.find(
      (v) =>
        v.labels.queue === 'embedding' && v.labels.state === 'waiting-children',
    )
    expect(waitingChildren?.value).toBe(4)

    // Advance another interval
    await vi.advanceTimersByTimeAsync(15_000)
    expect(getJobCounts).toHaveBeenCalledTimes(2)

    stop()
  })

  it('stop() prevents further polling', async () => {
    const registry = new Registry()
    const gauge = new Gauge({
      name: 'bullmq_queue_jobs_stop_test',
      help: 'test',
      labelNames: ['queue', 'state'] as const,
      registers: [registry],
    })

    const getJobCounts = vi.fn().mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
    })
    const mockQueue = { name: 'prediction', getJobCounts } as never

    const { stop } = startQueueDepthPolling([mockQueue], gauge, 15_000)
    stop()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(getJobCounts).not.toHaveBeenCalled()
  })

  it('swallows transient errors from getJobCounts without crashing', async () => {
    const registry = new Registry()
    const gauge = new Gauge({
      name: 'bullmq_queue_jobs_err_test',
      help: 'test',
      labelNames: ['queue', 'state'] as const,
      registers: [registry],
    })

    const getJobCounts = vi
      .fn()
      .mockRejectedValue(new Error('Redis connection lost'))
    const mockQueue = { name: 'embedding', getJobCounts } as never

    const { stop } = startQueueDepthPolling([mockQueue], gauge, 15_000)

    // Should not throw
    await expect(vi.advanceTimersByTimeAsync(15_000)).resolves.not.toThrow()
    stop()
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})

describe('startSheddingStatePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshes the shedding gauges from readState each tick', async () => {
    const m = createMetrics()
    const readState = vi
      .fn()
      .mockResolvedValue({ pendingResidues: 800, residuesPerSecondEwma: 400 })

    const { stop } = startSheddingStatePolling({ readState }, m, 15_000)
    await vi.advanceTimersByTimeAsync(15_000)

    expect(readState).toHaveBeenCalledOnce()
    expect((await m.shedingPendingResidues.get()).values[0]?.value).toBe(800)
    expect((await m.shedingResiduesPerSecond.get()).values[0]?.value).toBe(400)
    // estimatedWait = pending / ewma = 800 / 400 = 2
    expect((await m.shedingEstimatedWait.get()).values[0]?.value).toBe(2)
    stop()
  })

  it('drives the pending gauge to zero at idle so the leak alert clears', async () => {
    const m = createMetrics()
    m.shedingPendingResidues.set(10_000_000) // stale request-time value
    const readState = vi
      .fn()
      .mockResolvedValue({ pendingResidues: 0, residuesPerSecondEwma: 1200 })

    const { stop } = startSheddingStatePolling({ readState }, m, 15_000)
    await vi.advanceTimersByTimeAsync(15_000)

    expect((await m.shedingPendingResidues.get()).values[0]?.value).toBe(0)
    expect((await m.shedingEstimatedWait.get()).values[0]?.value).toBe(0)
    stop()
  })

  it('swallows transient readState errors and stop() halts polling', async () => {
    const m = createMetrics()
    const readState = vi.fn().mockRejectedValue(new Error('Redis blip'))

    const { stop } = startSheddingStatePolling({ readState }, m, 15_000)
    await expect(vi.advanceTimersByTimeAsync(15_000)).resolves.not.toThrow()
    expect(readState).toHaveBeenCalledOnce()

    stop()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(readState).toHaveBeenCalledOnce()
  })
})
