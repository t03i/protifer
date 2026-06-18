import { createServer } from 'node:http'

import { Histogram, Registry } from 'prom-client'

// Per-Triton-call buckets: sub-second to the gRPC deadline (~90s).
const TRITON_INFER_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 90]
// Per-job buckets: fan-out / embedding jobs run longer than a single call.
const JOB_DURATION_BUCKETS = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300]

export interface WorkerMetrics {
  registry: Registry
  tritonModelInferDuration: Histogram<'model' | 'status'>
  predictionJobDuration: Histogram<'status'>
  embeddingJobDuration: Histogram<'status'>
}

/**
 * Client-observed worker latency histograms over a private registry. Both
 * workers create identical metric names/labels via this factory. `status` is a
 * bounded set: `success` or a gRPC error class (see {@link classifyTritonStatus}
 * and the prediction worker's `classifyError`) — never a free-form string.
 */
export function createWorkerMetrics(): WorkerMetrics {
  const registry = new Registry()

  const tritonModelInferDuration = new Histogram({
    name: 'triton_model_infer_duration_seconds',
    help: 'Client-observed Triton modelInfer duration by model and status (success or gRPC error class), including time-to-failure.',
    labelNames: ['model', 'status'] as const,
    buckets: TRITON_INFER_BUCKETS,
    registers: [registry],
  })

  const predictionJobDuration = new Histogram({
    name: 'prediction_job_duration_seconds',
    help: 'Wall-clock of the prediction model fan-out per job, by status (success|failure).',
    labelNames: ['status'] as const,
    buckets: JOB_DURATION_BUCKETS,
    registers: [registry],
  })

  const embeddingJobDuration = new Histogram({
    name: 'embedding_job_duration_seconds',
    help: 'Wall-clock per embedding job, by status (success|failure).',
    labelNames: ['status'] as const,
    buckets: JOB_DURATION_BUCKETS,
    registers: [registry],
  })

  return {
    registry,
    tritonModelInferDuration,
    predictionJobDuration,
    embeddingJobDuration,
  }
}

// gRPC numeric status → bounded label value. Mirrors the prediction worker's
// GRPC_CODE_MAP so both workers emit the same closed status set.
const GRPC_STATUS_MAP: Record<number, string> = {
  3: 'INVALID_ARGUMENT',
  4: 'DEADLINE_EXCEEDED',
  5: 'NOT_FOUND',
  13: 'INTERNAL',
  14: 'UNAVAILABLE',
}

/** Map a thrown Triton/gRPC error to a bounded `status` label value. */
export function classifyTritonStatus(err: unknown): string {
  if (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'number'
  ) {
    return GRPC_STATUS_MAP[(err as { code: number }).code] ?? 'INTERNAL'
  }
  return 'INTERNAL'
}

export interface MetricsServerHandle {
  close: () => Promise<void>
}

/**
 * Serve the registry as Prometheus text over `GET /metrics`. Kept tiny and
 * `unref`'d so it never blocks job processing or shutdown; close it explicitly
 * in the SIGTERM drain path.
 */
export function startMetricsServer(opts: {
  registry: Registry
  port: number
  host?: string
}): MetricsServerHandle {
  const { registry, port, host } = opts

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/metrics') {
      registry
        .metrics()
        .then((body) => {
          res.writeHead(200, { 'Content-Type': registry.contentType })
          res.end(body)
        })
        .catch(() => {
          res.writeHead(500).end()
        })
      return
    }
    res.writeHead(404).end()
  })

  server.listen(port, host)
  server.unref()

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      }),
  }
}
