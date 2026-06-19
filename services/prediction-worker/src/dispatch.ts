import type {
  ModelErrorCode,
  ModelErrorEntry,
  ModelErrors,
  PredictionOutputs,
  WorkerMetrics,
} from '@protifer/shared'
import { DEFAULT_DEADLINE_MS } from '@protifer/triton-client'
import type {
  ModelInferRetryOptions,
  TritonClient,
} from '@protifer/triton-client'

import { ShapeError, DtypeError, DecodeError } from './adapters/errors.ts'
import { ADAPTER_REGISTRY } from './adapters/index.ts'
import type { AdapterContext, ModelAdapter } from './adapters/types.ts'
import type { Semaphore } from './semaphore.ts'

const MAX_MESSAGE_LEN = 200

// gRPC status numeric → ModelErrorCode (subset per RESEARCH.md §classifyError).
const GRPC_CODE_MAP: Record<number, ModelErrorCode> = {
  3: 'INVALID_ARGUMENT',
  4: 'DEADLINE_EXCEEDED',
  5: 'NOT_FOUND',
  13: 'INTERNAL',
  14: 'UNAVAILABLE',
}

/**
 * Classify a thrown value into a stable {code, message} pair for ModelErrorEntry.
 * Never includes stack traces or full error objects — only bounded strings.
 * Never throws.
 */
export function classifyError(err: unknown): {
  code: ModelErrorCode
  message: string
} {
  // Adapter-side errors first.
  if (err instanceof ShapeError)
    return { code: 'SHAPE_MISMATCH', message: truncate(err.message) }
  if (err instanceof DtypeError)
    return { code: 'DTYPE_MISMATCH', message: truncate(err.message) }
  if (err instanceof DecodeError)
    return { code: 'DECODE_ERROR', message: truncate(err.message) }

  // gRPC ServiceError — numeric .code field set by @grpc/grpc-js.
  // Guard typeof .code === 'number' so a string-typed .code can't enter this branch.
  if (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'number'
  ) {
    const grpcCode = (err as { code: number }).code
    const code = GRPC_CODE_MAP[grpcCode] ?? 'INTERNAL'
    const raw =
      (err as { details?: string }).details ??
      (err as { message?: string }).message ??
      'gRPC error'
    return { code, message: truncate(raw) }
  }

  // Generic Error — extract message only, never the stack trace (info disclosure).
  if (err instanceof Error) {
    return {
      code: 'DECODE_ERROR',
      message: truncate(err.message || String(err)),
    }
  }

  // Anything else (string, null, undefined, number).
  return { code: 'DECODE_ERROR', message: truncate(String(err)) }
}

function truncate(s: string): string {
  return s.length > MAX_MESSAGE_LEN ? s.slice(0, MAX_MESSAGE_LEN) : s
}

/**
 * Fan-out: build + invoke + decode all adapters from ADAPTER_REGISTRY concurrently
 * via Promise.allSettled.
 *
 * Partial-failure contract:
 * - ≥1 success → return normally with populated outputs + modelErrors for failed ones.
 * - 0 successes → return empty outputs + full modelErrors. Caller decides whether to throw
 *   (prediction-worker/src/processor.ts throws iff outputs is empty).
 *
 * No per-model retries; BullMQ whole-job retry handles transients.
 */
async function withPermit<T>(
  semaphore: Semaphore | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!semaphore) return fn()
  const release = await semaphore.acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}

export async function dispatchAll(
  triton: TritonClient,
  ctx: AdapterContext,
  {
    deadlineMs = DEFAULT_DEADLINE_MS,
    metrics,
    semaphore,
    retry,
  }: {
    deadlineMs?: number
    metrics?: WorkerMetrics
    semaphore?: Semaphore
    retry?: ModelInferRetryOptions
  } = {},
): Promise<{ outputs: PredictionOutputs; modelErrors: ModelErrors }> {
  const adapters = Object.values(ADAPTER_REGISTRY) as ModelAdapter[]

  const settled = await Promise.allSettled(
    adapters.map(async (adapter) => {
      const endTimer = metrics?.tritonModelInferDuration.startTimer({
        model: adapter.modelName,
      })
      try {
        const req = adapter.buildRequest(ctx)
        const resp = await withPermit(semaphore, () =>
          triton.modelInfer(req, { deadlineMs, retry }),
        )
        const decoded = adapter.decodeResponse(resp)
        endTimer?.({ status: 'success' })
        return { adapter, decoded }
      } catch (err) {
        endTimer?.({ status: classifyError(err).code })
        // Tagged Error so the outer loop can attribute the failure.
        // Do NOT spread err — info-disclosure mitigation.
        throw new Error('adapter failure', { cause: { adapter, err } })
      }
    }),
  )

  const outputs: PredictionOutputs = {}
  const modelErrors: ModelErrors = {}

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      const { adapter, decoded } = result.value
      ;(outputs as Record<string, unknown>)[adapter.outputKey] = decoded
    } else {
      const cause = (
        result.reason as Error & {
          cause?: { adapter: ModelAdapter; err: unknown }
        }
      ).cause
      if (cause === undefined) continue
      const { code, message } = classifyError(cause.err)
      const entry: ModelErrorEntry = {
        code,
        message,
        failedAt: new Date().toISOString(),
      }
      ;(modelErrors as Record<string, ModelErrorEntry>)[
        cause.adapter.outputKey
      ] = entry
    }
  }

  return { outputs, modelErrors }
}
