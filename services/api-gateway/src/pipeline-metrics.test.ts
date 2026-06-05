import { EventEmitter } from 'events'

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { createMetrics } from './metrics.ts'
import {
  attachPipelineMetrics,
  classifyFailureReason,
  createStaleChildrenScan,
} from './pipeline-metrics.ts'

describe('classifyFailureReason', () => {
  it.each([
    // failParentOnFailure cascade — BullMQ fails the parent with "child <key> failed"
    ['child bull:embedding:abc123 failed', 'embedding_cascade'],
    // @grpc/grpc-js renderings
    ['14 UNAVAILABLE: No connection established', 'triton_unavailable'],
    [
      'Error: 14 UNAVAILABLE: connect ECONNREFUSED 10.0.0.5:8001',
      'triton_unavailable',
    ],
    ['4 DEADLINE_EXCEEDED: Deadline exceeded', 'timeout'],
    ['request timed out after 30000ms', 'timeout'],
    ['Operation timeout', 'timeout'],
    ['JavaScript heap out of memory', 'worker_oom'],
    ['worker killed: OOM', 'worker_oom'],
    ['Reached heap limit Allocation failed', 'worker_oom'],
    ['All prediction models failed — tmbed: SHAPE_MISMATCH', 'other'],
    ['Triton returned no output tensor for prot_t5_pipeline', 'other'],
    ['', 'other'],
    [undefined, 'other'],
  ])('classifies %j as %s', (reason, expected) => {
    expect(classifyFailureReason(reason)).toBe(expected)
  })

  it('never returns a raw error string', () => {
    const result = classifyFailureReason('some wild unexpected error string')
    expect([
      'embedding_cascade',
      'triton_unavailable',
      'worker_oom',
      'timeout',
      'other',
    ]).toContain(result)
  })
})

describe('attachPipelineMetrics', () => {
  let metrics: ReturnType<typeof createMetrics>
  let events: EventEmitter
  let getJob: ReturnType<typeof vi.fn>

  beforeEach(() => {
    metrics = createMetrics()
    events = new EventEmitter()
    getJob = vi.fn()
    attachPipelineMetrics({
      events,
      queue: { name: 'prediction', getJob },
      metrics,
    })
  })

  async function flush() {
    await new Promise((r) => setTimeout(r, 0))
  }

  async function histogramSum(name: string) {
    const metric = await metrics.registry.getSingleMetric(name)?.get()
    const sum = metric?.values.find(
      (v) => v.metricName === `${name}_sum` && v.labels.queue === 'prediction',
    )
    return sum?.value
  }

  async function counterValue(
    name: string,
    labels: Record<string, string> = { queue: 'prediction' },
  ) {
    const metric = await metrics.registry.getSingleMetric(name)?.get()
    return metric?.values.find((v) =>
      Object.entries(labels).every(([k, val]) => v.labels[k] === val),
    )?.value
  }

  it('completed job feeds all three duration histograms', async () => {
    getJob.mockResolvedValue({
      timestamp: 1_000,
      processedOn: 31_000,
      finishedOn: 91_000,
      attemptsMade: 1,
    })

    events.emit('completed', { jobId: 'j1' })
    await flush()

    expect(getJob).toHaveBeenCalledWith('j1')
    expect(await histogramSum('bullmq_job_wait_duration_seconds')).toBe(30)
    expect(await histogramSum('bullmq_job_processing_duration_seconds')).toBe(
      60,
    )
    expect(await histogramSum('bullmq_job_total_duration_seconds')).toBe(90)
  })

  it('completed job observes attempts and counts retries beyond the first', async () => {
    getJob.mockResolvedValue({
      timestamp: 0,
      processedOn: 10,
      finishedOn: 20,
      attemptsMade: 3,
    })

    events.emit('completed', { jobId: 'j2' })
    await flush()

    expect(await histogramSum('bullmq_job_attempts')).toBe(3)
    expect(await counterValue('bullmq_job_retries_total')).toBe(2)
  })

  it('first-attempt success records no retries', async () => {
    getJob.mockResolvedValue({
      timestamp: 0,
      processedOn: 10,
      finishedOn: 20,
      attemptsMade: 1,
    })

    events.emit('completed', { jobId: 'j3' })
    await flush()

    expect(await counterValue('bullmq_job_retries_total')).toBeUndefined()
  })

  it('failed event increments classified failure counter without raw labels', async () => {
    getJob.mockResolvedValue({ timestamp: 0, attemptsMade: 1 })

    events.emit('failed', {
      jobId: 'j4',
      failedReason: 'child bull:embedding:deadbeef failed',
    })
    await flush()

    expect(
      await counterValue('bullmq_job_failures_total', {
        queue: 'prediction',
        reason_class: 'embedding_cascade',
      }),
    ).toBe(1)
    const metric = await metrics.registry
      .getSingleMetric('bullmq_job_failures_total')
      ?.get()
    for (const v of metric?.values ?? []) {
      expect(v.labels.reason_class).not.toContain('deadbeef')
    }
  })

  it('unknown failure modes degrade to reason_class=other', async () => {
    getJob.mockResolvedValue({ timestamp: 0, attemptsMade: 1 })

    events.emit('failed', { jobId: 'j5', failedReason: 'mystery explosion' })
    await flush()

    expect(
      await counterValue('bullmq_job_failures_total', {
        queue: 'prediction',
        reason_class: 'other',
      }),
    ).toBe(1)
  })

  it('terminal failure after retries counts the retry attempts', async () => {
    getJob.mockResolvedValue({ timestamp: 0, attemptsMade: 3 })

    events.emit('failed', { jobId: 'j6', failedReason: 'whatever' })
    await flush()

    expect(await counterValue('bullmq_job_retries_total')).toBe(2)
  })

  it('stalled event increments the stalled counter', async () => {
    events.emit('stalled', { jobId: 'j7' })
    await flush()

    expect(await counterValue('bullmq_stalled_total')).toBe(1)
  })

  it('survives getJob rejections and missing jobs', async () => {
    getJob.mockRejectedValueOnce(new Error('redis down'))
    events.emit('completed', { jobId: 'gone' })
    await flush()

    getJob.mockResolvedValueOnce(null)
    events.emit('completed', { jobId: 'gone2' })
    await flush()

    expect(
      await histogramSum('bullmq_job_total_duration_seconds'),
    ).toBeUndefined()
  })

  it('skips duration observations when timestamps are missing', async () => {
    getJob.mockResolvedValue({ timestamp: 1000, attemptsMade: 1 })

    events.emit('completed', { jobId: 'j8' })
    await flush()

    expect(
      await histogramSum('bullmq_job_wait_duration_seconds'),
    ).toBeUndefined()
    expect(
      await histogramSum('bullmq_job_total_duration_seconds'),
    ).toBeUndefined()
    expect(await histogramSum('bullmq_job_attempts')).toBe(1)
  })
})

describe('createStaleChildrenScan', () => {
  const NOW = 10_000_000
  const KEY = 'bull:prediction:waiting-children'
  const THRESHOLD = 1_800_000

  async function gaugeValue(
    metrics: ReturnType<typeof createMetrics>,
    name: string,
  ) {
    const metric = await metrics.registry.getSingleMetric(name)?.get()
    return metric?.values[0]?.value
  }

  function setup(redis: {
    zrangebyscore: ReturnType<typeof vi.fn>
    zscore: ReturnType<typeof vi.fn>
  }) {
    const metrics = createMetrics()
    const scan = createStaleChildrenScan({
      redis,
      waitingChildrenKey: KEY,
      metrics,
      thresholdMs: THRESHOLD,
      clock: { now: () => NOW },
    })
    return { metrics, scan }
  }

  it('counts ZSET members below the cutoff and reports the oldest age from its score', async () => {
    const redis = {
      zrangebyscore: vi.fn().mockResolvedValue(['job-old', 'job-newer']),
      // job-old entered waiting-children 1h ago
      zscore: vi.fn().mockResolvedValue(String(NOW - 3_600_000)),
    }
    const { metrics, scan } = setup(redis)

    await scan()

    expect(redis.zrangebyscore).toHaveBeenCalledWith(
      KEY,
      '-inf',
      NOW - THRESHOLD,
    )
    expect(redis.zscore).toHaveBeenCalledWith(KEY, 'job-old')
    expect(await gaugeValue(metrics, 'bullmq_stale_children_jobs')).toBe(2)
    expect(
      await gaugeValue(metrics, 'bullmq_stale_children_oldest_seconds'),
    ).toBe(3600)
  })

  it('resets both gauges to 0 when nothing is stale, without fetching scores', async () => {
    const redis = {
      zrangebyscore: vi.fn().mockResolvedValue([]),
      zscore: vi.fn(),
    }
    const { metrics, scan } = setup(redis)
    metrics.bullmqStaleChildrenJobs.set(5)
    metrics.bullmqStaleChildrenOldest.set(120)

    await scan()

    expect(await gaugeValue(metrics, 'bullmq_stale_children_jobs')).toBe(0)
    expect(
      await gaugeValue(metrics, 'bullmq_stale_children_oldest_seconds'),
    ).toBe(0)
    expect(redis.zscore).not.toHaveBeenCalled()
  })

  it('degrades to oldest=0 when the job leaves the state between calls', async () => {
    const redis = {
      zrangebyscore: vi.fn().mockResolvedValue(['job-gone']),
      zscore: vi.fn().mockResolvedValue(null),
    }
    const { metrics, scan } = setup(redis)

    await scan()

    expect(await gaugeValue(metrics, 'bullmq_stale_children_jobs')).toBe(1)
    expect(
      await gaugeValue(metrics, 'bullmq_stale_children_oldest_seconds'),
    ).toBe(0)
  })

  it('observes without touching jobs — only read commands are required or called', async () => {
    const redis = {
      zrangebyscore: vi.fn().mockResolvedValue([]),
      zscore: vi.fn(),
    }
    const { scan } = setup(redis)

    await scan()

    // The scan's redis surface is read-only; ZRANGEBYSCORE/ZSCORE only.
    expect(Object.keys(redis)).toEqual(['zrangebyscore', 'zscore'])
    expect(redis.zrangebyscore).toHaveBeenCalledOnce()
  })
})
