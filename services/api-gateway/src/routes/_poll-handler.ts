import { defaultPinoOptions } from '@protifer/shared'
import type { Job, ObjectStore } from '@protifer/shared'
import pino from 'pino'

const logger = pino({ name: 'api-gateway:poll', ...defaultPinoOptions() })

export interface PollEnvelope {
  status: number
  body: Record<string, unknown>
}

export interface PollCompletedArgs<JobData> {
  jobId: string
  data: JobData
  buf: Buffer
}

export interface PollFailedArgs<JobData> {
  jobId: string
  job: Job<JobData>
}

export interface PollMissingArgs<JobData> {
  jobId: string
  data: JobData
}

export interface PollPendingArgs<JobData> {
  jobId: string
  job: Job<JobData>
  state: string
}

export interface PollDeps<JobData extends { userId: string }> {
  kind: 'embedding' | 'prediction'
  getJob: (id: string) => Promise<Job<JobData> | null | undefined>
  refKey: (data: JobData) => string
  store: Pick<ObjectStore, 'exists' | 'get'>
  /**
   * The authenticated user making the request. When set, the handler enforces
   * ownership: a job whose `data.userId` does not match `requesterId` is
   * treated as not found (404) to avoid disclosing job existence (IDOR).
   */
  requesterId?: string
  /** Build the success envelope once the payload is loaded from storage. */
  renderCompleted: (
    args: PollCompletedArgs<JobData>,
  ) => PollEnvelope | Promise<PollEnvelope>
  /**
   * Override the failed-state envelope. Default returns a generic
   * `{status: 200, body: {status: 'failed', jobId, error: 'Job failed', code: 'JOB_FAILED'}}`
   * and logs the raw `failedReason` server-side (never surfaced to clients).
   */
  renderFailed?: (
    args: PollFailedArgs<JobData>,
  ) => PollEnvelope | Promise<PollEnvelope>
  /**
   * Called when state is `completed` but the ref is missing from the store.
   * Default: fall through to the pending (queued/processing) envelope.
   */
  renderMissing?: (
    args: PollMissingArgs<JobData>,
  ) => PollEnvelope | Promise<PollEnvelope>
  /**
   * Override the queued/processing envelope. Default uses `state === 'active'`
   * to decide between `processing` and `queued`.
   */
  renderPending?: (
    args: PollPendingArgs<JobData>,
  ) => PollEnvelope | Promise<PollEnvelope>
}

/**
 * Shared poll-endpoint body. Callers wire it into a Hono route and forward
 * `{status, body}` to `c.json`. Status transitions match the current
 * embeddings/predictions routes exactly.
 */
export function createPollHandler<JobData extends { userId: string }>(
  deps: PollDeps<JobData>,
) {
  return async function pollHandler(jobId: string): Promise<PollEnvelope> {
    const job = await deps.getJob(jobId)
    if (!job) {
      return { status: 404, body: { status: 'not_found', jobId } }
    }

    // Ownership check: return 404 (not 403) to avoid disclosing job existence.
    if (
      deps.requesterId !== undefined &&
      job.data.userId !== deps.requesterId
    ) {
      return { status: 404, body: { status: 'not_found', jobId } }
    }

    const state = await job.getState()

    if (state === 'failed') {
      if (deps.renderFailed) {
        return await deps.renderFailed({ jobId, job })
      }
      logger.warn(
        {
          jobId,
          kind: deps.kind,
          failedReason: job.failedReason || 'Unknown error',
        },
        'job failed',
      )
      return {
        status: 200,
        body: {
          status: 'failed',
          jobId,
          error: 'Job failed',
          code: 'JOB_FAILED',
        },
      }
    }

    if (state === 'completed') {
      const { data } = job
      const ref = deps.refKey(data)
      if (await deps.store.exists(ref)) {
        const buf = await deps.store.get(ref)
        return await deps.renderCompleted({ jobId, data, buf })
      }
      if (deps.renderMissing) {
        return await deps.renderMissing({ jobId, data })
      }
      // Fall through to pending below.
    }

    if (deps.renderPending) {
      return await deps.renderPending({ jobId, job, state })
    }
    return {
      status: 202,
      body: {
        status: state === 'active' ? 'processing' : 'queued',
        jobId,
      },
    }
  }
}
