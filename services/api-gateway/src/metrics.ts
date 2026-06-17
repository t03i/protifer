import type { Queue } from '@protifer/shared'
import { Counter, Gauge, Histogram, Registry } from 'prom-client'

export type ReconcileReason = 'completed' | 'failed' | 'no-job'
export type SweepOutcome = 'ran' | 'skipped-not-leader' | 'error'

export type QueueJobState =
  | 'waiting'
  | 'active'
  | 'delayed'
  | 'failed'
  | 'completed'
  | 'waiting-children'

export interface JobCleanupMetrics {
  reconciled: Counter<'reason'>
  sweeps: Counter<'outcome'>
  sweepDuration: Histogram
  registry: Registry
}

export interface SheddingPromMetrics {
  requestsShedTotal: Counter<'mode' | 'plan' | 'outcome' | 'code'>
  shedingEstimatedWait: Gauge
  shedingResiduesPerSecond: Gauge
  shedingPendingResidues: Gauge
}

export interface FlagsPromMetrics {
  featureFlagEvaluations: Counter<'flag' | 'outcome' | 'plan'>
}

export interface PipelinePromMetrics {
  bullmqJobWaitDuration: Histogram<'queue'>
  bullmqJobProcessingDuration: Histogram<'queue'>
  bullmqJobTotalDuration: Histogram<'queue'>
  bullmqJobFailures: Counter<'queue' | 'reason_class'>
  bullmqJobRetries: Counter<'queue'>
  bullmqJobAttempts: Histogram<'queue'>
  bullmqStalled: Counter<'queue'>
  bullmqStaleChildrenJobs: Gauge
  bullmqStaleChildrenOldest: Gauge
}

export interface AppMetrics
  extends
    JobCleanupMetrics,
    SheddingPromMetrics,
    FlagsPromMetrics,
    PipelinePromMetrics {
  httpRequestsTotal: Counter<'method' | 'route' | 'status'>
  httpRequestDuration: Histogram<'method' | 'route' | 'status'>
  bullmqQueueJobs: Gauge<'queue' | 'state'>
}

// Inference jobs range from sub-second cache hits to long GPU batches stuck
// behind a backlog — buckets span 500ms to 1h.
const JOB_DURATION_BUCKETS = [
  0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600,
]

export function createMetrics(): AppMetrics {
  const registry = new Registry()

  const reconciled = new Counter({
    name: 'job_cleanup_reconciled_total',
    help: 'Total stale active-job ZSET entries removed by the reconciliation sweep.',
    labelNames: ['reason'] as const,
    registers: [registry],
  })

  const sweeps = new Counter({
    name: 'job_cleanup_sweeps_total',
    help: 'Total reconciliation sweep ticks, by outcome.',
    labelNames: ['outcome'] as const,
    registers: [registry],
  })

  const sweepDuration = new Histogram({
    name: 'job_cleanup_sweep_duration_seconds',
    help: 'Wall-clock duration of a reconciliation sweep body (excludes lock acquisition).',
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  })

  const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests handled, labelled by method, route pattern, and status code.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  })

  const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds, labelled by method, route pattern, and status code.',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  })

  const bullmqQueueJobs = new Gauge({
    name: 'bullmq_queue_jobs',
    help: 'Current job count per BullMQ queue and state.',
    labelNames: ['queue', 'state'] as const,
    registers: [registry],
  })

  const requestsShedTotal = new Counter({
    name: 'requests_shed_total',
    help: 'Total admission-controller decisions, by mode, plan, outcome (admit|shed) and shed code (OVERLOADED|UPSTREAM_DOWN|"" when admitted).',
    labelNames: ['mode', 'plan', 'outcome', 'code'] as const,
    registers: [registry],
  })

  const shedingEstimatedWait = new Gauge({
    name: 'shedding_estimated_wait_seconds',
    help: 'Most recent admission-time estimated wait (seconds) = pending_residues / ewma.',
    registers: [registry],
  })

  const shedingResiduesPerSecond = new Gauge({
    name: 'shedding_residues_per_second',
    help: 'Current EWMA of aggregate pipeline drain rate (residues per second) across both queues.',
    registers: [registry],
  })

  const shedingPendingResidues = new Gauge({
    name: 'shedding_pending_residues',
    help: 'Current pending-residues across both queues (waiting + active + waiting-children), reconciled by the leader sweep.',
    registers: [registry],
  })

  const featureFlagEvaluations = new Counter({
    name: 'feature_flag_evaluations_total',
    help: 'Feature flag evaluations by flag name, outcome (default|override|error) and plan (free|pro|enterprise|unknown).',
    labelNames: ['flag', 'outcome', 'plan'] as const,
    registers: [registry],
  })

  const bullmqJobWaitDuration = new Histogram({
    name: 'bullmq_job_wait_duration_seconds',
    help: 'Time a job spent queued before processing started (processedOn − timestamp).',
    labelNames: ['queue'] as const,
    buckets: JOB_DURATION_BUCKETS,
    registers: [registry],
  })

  const bullmqJobProcessingDuration = new Histogram({
    name: 'bullmq_job_processing_duration_seconds',
    help: 'Time a job spent in the worker (finishedOn − processedOn).',
    labelNames: ['queue'] as const,
    buckets: JOB_DURATION_BUCKETS,
    registers: [registry],
  })

  const bullmqJobTotalDuration = new Histogram({
    name: 'bullmq_job_total_duration_seconds',
    help: 'End-to-end job duration as the user experiences it (finishedOn − timestamp).',
    labelNames: ['queue'] as const,
    buckets: JOB_DURATION_BUCKETS,
    registers: [registry],
  })

  const bullmqJobFailures = new Counter({
    name: 'bullmq_job_failures_total',
    help: 'Terminally failed jobs by queue and bounded reason class (embedding_cascade|triton_unavailable|worker_oom|timeout|other). A cascaded child failure increments both queues (root class on embedding, embedding_cascade on prediction). Resets on gateway restart — alert with rate()/increase().',
    labelNames: ['queue', 'reason_class'] as const,
    registers: [registry],
  })

  const bullmqJobRetries = new Counter({
    name: 'bullmq_job_retries_total',
    help: 'Retry attempts beyond the first, counted when a job reaches a terminal state.',
    labelNames: ['queue'] as const,
    registers: [registry],
  })

  const bullmqJobAttempts = new Histogram({
    name: 'bullmq_job_attempts',
    help: 'Attempts needed for a job to complete successfully.',
    labelNames: ['queue'] as const,
    buckets: [1, 2, 3, 5],
    registers: [registry],
  })

  const bullmqStalled = new Counter({
    name: 'bullmq_stalled_total',
    help: 'Jobs whose lock expired mid-processing (BullMQ stalled events).',
    labelNames: ['queue'] as const,
    registers: [registry],
  })

  const bullmqStaleChildrenJobs = new Gauge({
    name: 'bullmq_stale_children_jobs',
    help: 'Prediction jobs stuck in waiting-children beyond the staleness threshold (FAIL-04 backstop; observe-only).',
    registers: [registry],
  })

  const bullmqStaleChildrenOldest = new Gauge({
    name: 'bullmq_stale_children_oldest_seconds',
    help: 'Seconds the oldest stale prediction job has sat in waiting-children (0 when none).',
    registers: [registry],
  })

  return {
    reconciled,
    sweeps,
    sweepDuration,
    httpRequestsTotal,
    httpRequestDuration,
    bullmqQueueJobs,
    requestsShedTotal,
    shedingEstimatedWait,
    shedingResiduesPerSecond,
    shedingPendingResidues,
    featureFlagEvaluations,
    bullmqJobWaitDuration,
    bullmqJobProcessingDuration,
    bullmqJobTotalDuration,
    bullmqJobFailures,
    bullmqJobRetries,
    bullmqJobAttempts,
    bullmqStalled,
    bullmqStaleChildrenJobs,
    bullmqStaleChildrenOldest,
    registry,
  }
}

const QUEUE_STATES: QueueJobState[] = [
  'waiting',
  'active',
  'delayed',
  'failed',
  'completed',
  'waiting-children',
]

export function startQueueDepthPolling(
  queues: Queue[],
  gauge: Gauge<'queue' | 'state'>,
  intervalMs = 15_000,
): { stop: () => void } {
  async function poll() {
    for (const queue of queues) {
      try {
        const counts = await queue.getJobCounts(...QUEUE_STATES)
        for (const state of QUEUE_STATES) {
          gauge.set({ queue: queue.name, state }, counts[state] ?? 0)
        }
      } catch {
        // transient Redis blip — skip this tick
      }
    }
  }

  const timer = setInterval(() => {
    void poll()
  }, intervalMs)
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    ;(timer as { unref: () => void }).unref()
  }

  return {
    stop: () => {
      clearInterval(timer)
    },
  }
}

interface SheddingStateReader {
  readState: () => Promise<{
    pendingResidues: number
    residuesPerSecondEwma: number
  }>
}

interface SheddingGauges {
  shedingPendingResidues: Gauge
  shedingResiduesPerSecond: Gauge
  shedingEstimatedWait: Gauge
}

// The shedding gauges are otherwise only written by the request middleware, so
// at idle they freeze at their last request-time value — which would make the
// pending-residue leak alert fire on stale data. Refresh them per-instance from
// the reconciled Redis state on a timer, mirroring queue-depth polling.
export function startSheddingStatePolling(
  state: SheddingStateReader,
  gauges: SheddingGauges,
  intervalMs = 15_000,
): { stop: () => void } {
  async function poll() {
    try {
      const snap = await state.readState()
      const throughput =
        snap.residuesPerSecondEwma > 0 ? snap.residuesPerSecondEwma : 1
      gauges.shedingPendingResidues.set(snap.pendingResidues)
      gauges.shedingResiduesPerSecond.set(snap.residuesPerSecondEwma)
      gauges.shedingEstimatedWait.set(snap.pendingResidues / throughput)
    } catch {
      // transient Redis blip — skip this tick
    }
  }

  const timer = setInterval(() => {
    void poll()
  }, intervalMs)
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    ;(timer as { unref: () => void }).unref()
  }

  return {
    stop: () => {
      clearInterval(timer)
    },
  }
}
