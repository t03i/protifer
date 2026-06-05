import { describe, it, expect, vi } from 'vitest'

import { createPollHandler } from './_poll-handler.ts'
import type { PollDeps } from './_poll-handler.ts'

// All mock job data must include `userId` because JobData extends { userId: string }.
type TestJobData = { userId: string; [key: string]: unknown }

function deps(
  overrides: Partial<PollDeps<TestJobData>> = {},
): PollDeps<TestJobData> {
  return {
    kind: 'embedding',
    getJob: vi.fn(),
    refKey: vi.fn().mockReturnValue('ref/abc'),
    store: {
      exists: vi.fn(),
      get: vi.fn(),
    } as unknown as PollDeps<TestJobData>['store'],
    renderCompleted: vi.fn(),
    ...overrides,
  }
}

describe('createPollHandler', () => {
  it('returns 404 when the job does not exist', async () => {
    const d = deps({ getJob: vi.fn().mockResolvedValue(null) })
    const handler = createPollHandler(d)
    const res = await handler('missing-id')
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ status: 'not_found', jobId: 'missing-id' })
  })

  it('returns generic failed envelope (status 200) without leaking failedReason', async () => {
    const job = {
      getState: vi.fn().mockResolvedValue('failed'),
      failedReason: 'boom',
      data: { userId: 'user-1' },
    }
    const d = deps({ getJob: vi.fn().mockResolvedValue(job) })
    const res = await createPollHandler(d)('id')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      status: 'failed',
      jobId: 'id',
      error: 'Job failed',
      code: 'JOB_FAILED',
    })
    // raw worker reason must not leak to clients
    expect(JSON.stringify(res.body)).not.toContain('boom')
  })

  it('returns generic failed envelope even when failedReason is missing', async () => {
    const job = {
      getState: vi.fn().mockResolvedValue('failed'),
      failedReason: undefined,
      data: { userId: 'user-1' },
    }
    const d = deps({ getJob: vi.fn().mockResolvedValue(job) })
    const res = await createPollHandler(d)('id')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      status: 'failed',
      error: 'Job failed',
      code: 'JOB_FAILED',
    })
  })

  it('returns 202 processing for active state', async () => {
    const job = {
      getState: vi.fn().mockResolvedValue('active'),
      data: { userId: 'user-1' },
    }
    const d = deps({ getJob: vi.fn().mockResolvedValue(job) })
    const res = await createPollHandler(d)('id')
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ status: 'processing', jobId: 'id' })
  })

  it('returns 202 queued for waiting state', async () => {
    const job = {
      getState: vi.fn().mockResolvedValue('waiting'),
      data: { userId: 'user-1' },
    }
    const d = deps({ getJob: vi.fn().mockResolvedValue(job) })
    const res = await createPollHandler(d)('id')
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ status: 'queued', jobId: 'id' })
  })

  it('delegates to renderCompleted when state=completed and store has the ref', async () => {
    const job = {
      getState: vi.fn().mockResolvedValue('completed'),
      data: { userId: 'user-1', foo: 1 },
    }
    const store = {
      exists: vi.fn().mockResolvedValue(true),
      get: vi.fn().mockResolvedValue(Buffer.from('x')),
    }
    const renderCompleted = vi.fn().mockReturnValue({
      status: 200,
      body: { status: 'complete', jobId: 'id' },
    })
    const d = deps({
      getJob: vi.fn().mockResolvedValue(job),
      store: store as unknown as PollDeps<TestJobData>['store'],
      renderCompleted,
    })
    const res = await createPollHandler(d)('id')
    expect(store.exists).toHaveBeenCalledWith('ref/abc')
    expect(store.get).toHaveBeenCalledWith('ref/abc')
    expect(renderCompleted).toHaveBeenCalledWith({
      jobId: 'id',
      data: { userId: 'user-1', foo: 1 },
      buf: Buffer.from('x'),
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'complete' })
  })

  it('falls through to queued envelope when completed but store is missing the ref (default behavior)', async () => {
    const job = {
      getState: vi.fn().mockResolvedValue('completed'),
      data: { userId: 'user-1' },
    }
    const store = {
      exists: vi.fn().mockResolvedValue(false),
      get: vi.fn(),
    }
    const renderCompleted = vi.fn()
    const d = deps({
      getJob: vi.fn().mockResolvedValue(job),
      store: store as unknown as PollDeps<TestJobData>['store'],
      renderCompleted,
    })
    const res = await createPollHandler(d)('id')
    expect(renderCompleted).not.toHaveBeenCalled()
    expect(store.get).not.toHaveBeenCalled()
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ status: 'queued', jobId: 'id' })
  })

  it('invokes renderMissing when provided and completed but ref missing', async () => {
    const job = {
      getState: vi.fn().mockResolvedValue('completed'),
      data: { userId: 'user-1', foo: 'bar' },
    }
    const store = {
      exists: vi.fn().mockResolvedValue(false),
      get: vi.fn(),
    }
    const renderMissing = vi.fn().mockReturnValue({
      status: 200,
      body: { status: 'failed', jobId: 'id', error: 'missing' },
    })
    const d = deps({
      getJob: vi.fn().mockResolvedValue(job),
      store: store as unknown as PollDeps<TestJobData>['store'],
      renderMissing,
    })
    const res = await createPollHandler(d)('id')
    expect(renderMissing).toHaveBeenCalledWith({
      jobId: 'id',
      data: { userId: 'user-1', foo: 'bar' },
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'failed', error: 'missing' })
  })

  it('uses renderFailed override to customize the failed envelope', async () => {
    const job = {
      getState: vi.fn().mockResolvedValue('failed'),
      failedReason: 'child 12345',
      data: { userId: 'user-1', foo: 'bar' },
    }
    const renderFailed = vi.fn().mockResolvedValue({
      status: 200,
      body: { status: 'failed', jobId: 'id', error: 'Embedding failed: oops' },
    })
    const d = deps({
      getJob: vi.fn().mockResolvedValue(job),
      renderFailed,
    })
    const res = await createPollHandler(d)('id')
    expect(renderFailed).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'id' }),
    )
    expect(res.body).toMatchObject({
      status: 'failed',
      error: 'Embedding failed: oops',
    })
  })

  it('uses renderPending override to customize queued/processing envelope', async () => {
    const job = {
      getState: vi.fn().mockResolvedValue('waiting'),
      data: { userId: 'user-1', foo: 'bar' },
    }
    const renderPending = vi.fn().mockResolvedValue({
      status: 202,
      body: { status: 'processing', jobId: 'id' },
    })
    const d = deps({
      getJob: vi.fn().mockResolvedValue(job),
      renderPending,
    })
    const res = await createPollHandler(d)('id')
    expect(renderPending).toHaveBeenCalled()
    expect(res.body).toMatchObject({ status: 'processing' })
  })
})

describe('createPollHandler — ownership enforcement (P4-02 IDOR fix)', () => {
  it('owner polls own job → normal status returned (not 404)', async () => {
    const job = {
      getState: vi.fn().mockResolvedValue('active'),
      data: { userId: 'owner-user' },
    }
    const d = deps({
      getJob: vi.fn().mockResolvedValue(job),
      requesterId: 'owner-user',
    })
    const res = await createPollHandler(d)('job-abc')
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ status: 'processing', jobId: 'job-abc' })
  })

  it("different user polls another user's job → 404 (no disclosure)", async () => {
    const job = {
      getState: vi.fn().mockResolvedValue('active'),
      data: { userId: 'owner-user' },
    }
    const d = deps({
      getJob: vi.fn().mockResolvedValue(job),
      requesterId: 'attacker-user',
    })
    const res = await createPollHandler(d)('job-abc')
    // Must be 404, not 403, to avoid disclosing job existence.
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ status: 'not_found', jobId: 'job-abc' })
  })

  it("different user polls another user's completed job → 404 (no disclosure)", async () => {
    const job = {
      getState: vi.fn().mockResolvedValue('completed'),
      data: { userId: 'owner-user' },
    }
    const d = deps({
      getJob: vi.fn().mockResolvedValue(job),
      requesterId: 'attacker-user',
    })
    const res = await createPollHandler(d)('job-abc')
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ status: 'not_found' })
  })

  it('no requesterId set → ownership check skipped (backward-compat)', async () => {
    // When requesterId is omitted the handler works as before (open).
    const job = {
      getState: vi.fn().mockResolvedValue('active'),
      data: { userId: 'some-user' },
    }
    const d = deps({
      getJob: vi.fn().mockResolvedValue(job),
      // no requesterId
    })
    const res = await createPollHandler(d)('job-abc')
    expect(res.status).toBe(202)
  })

  it('demo user polls demo job → success (userId === requesterId === "demo")', async () => {
    const job = {
      getState: vi.fn().mockResolvedValue('active'),
      data: { userId: 'demo' },
    }
    const d = deps({
      getJob: vi.fn().mockResolvedValue(job),
      requesterId: 'demo',
    })
    const res = await createPollHandler(d)('demo-job')
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ status: 'processing' })
  })
})
