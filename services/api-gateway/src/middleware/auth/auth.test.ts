import type { EffectiveLimits } from '@protifer/shared'
import { Hono } from 'hono'
import { describe, it, expect, vi } from 'vitest'

import { createAuthenticateMiddleware } from './index.ts'
import type { Auth } from '../../auth/index.ts'
import type { UserDirectory, UserRecord } from '../../auth/user-directory.ts'
import type { Variables } from '../../types/hono.ts'

const limitsFor = (submissionsPerMinute: number): EffectiveLimits => ({
  submissionsPerMinute,
  maxConcurrentJobs: 2,
  maxSequenceLength: 4096,
  sloSeconds: 30,
})

const freeResolver = {
  resolve: () =>
    Promise.resolve({ plan: 'free' as const, limits: limitsFor(10) }),
}
const proResolver = {
  resolve: () =>
    Promise.resolve({ plan: 'pro' as const, limits: limitsFor(60) }),
}

function makeAuth(
  session: { user: { id: string; email: string; role?: string } } | null,
): Auth {
  return {
    api: {
      getSession: vi
        .fn()
        .mockResolvedValue(
          session ? { session: {}, user: session.user } : null,
        ),
    },
  } as unknown as Auth
}

describe('createAuthenticateMiddleware — normal session flow', () => {
  it('returns 401 when no session on POST', async () => {
    const auth = makeAuth(null)
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', createAuthenticateMiddleware({ auth, resolver: freeResolver }))
    app.post('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test', {
      method: 'POST',
      body: JSON.stringify({ sequence: 'MEEPQ' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })

  it('sets auth context from session user', async () => {
    const auth = makeAuth({
      user: { id: 'user-123', email: 'test@example.com' },
    })
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', createAuthenticateMiddleware({ auth, resolver: proResolver }))
    app.get('/test', (c) => c.json(c.get('auth')))

    const res = await app.request('/test')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      sub: string
      email: string
      plan: string
      method: string
    }
    expect(body.sub).toBe('user-123')
    expect(body.email).toBe('test@example.com')
    expect(body.plan).toBe('pro')
    expect(body.method).toBe('session')
  })

  it('propagates role from session user into auth context', async () => {
    const auth = makeAuth({
      user: { id: 'admin-1', email: 'admin@example.com', role: 'admin' },
    })
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', createAuthenticateMiddleware({ auth, resolver: freeResolver }))
    app.get('/test', (c) => c.json(c.get('auth')))

    const res = await app.request('/test')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { role?: string }
    expect(body.role).toBe('admin')
  })
})

describe('createAuthenticateMiddleware — legacy headers are ignored', () => {
  it('ignores x-test-user-id header', async () => {
    const auth = makeAuth(null)
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', createAuthenticateMiddleware({ auth, resolver: freeResolver }))
    app.get('/test', (c) => c.json(c.get('auth')))

    const res = await app.request('/test', {
      headers: { 'X-Test-User-Id': 'attacker' },
    })
    expect(res.status).toBe(401)
  })

  it('ignores x-load-test-key header', async () => {
    const auth = makeAuth(null)
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', createAuthenticateMiddleware({ auth, resolver: freeResolver }))
    app.post('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test', {
      method: 'POST',
      body: JSON.stringify({ sequence: 'MEEPQ' }),
      headers: {
        'Content-Type': 'application/json',
        'x-load-test-key': 'still-set-for-some-reason',
      },
    })
    expect(res.status).toBe(401)
  })
})

describe('createAuthenticateMiddleware — truthy-but-empty session', () => {
  it('treats session with null user as unauthenticated', async () => {
    const auth = {
      api: {
        getSession: vi.fn().mockResolvedValue({ session: null, user: null }),
      },
    } as unknown as Auth
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', createAuthenticateMiddleware({ auth, resolver: freeResolver }))
    app.post('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test', {
      method: 'POST',
      body: JSON.stringify({ sequence: 'MEEPQ', accession: 'P04637' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })
})

describe('demo bypass is removed (precompute-demo-artifacts)', () => {
  it('unauthenticated POST with a demo accession returns 401', async () => {
    const auth = makeAuth(null)
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', createAuthenticateMiddleware({ auth, resolver: freeResolver }))
    app.post('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test', {
      method: 'POST',
      body: JSON.stringify({ sequence: 'MEEPQ', accession: 'P04637' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })

  it('unauthenticated GET on any jobId returns 401 without queue inspection', async () => {
    const auth = makeAuth(null)
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', createAuthenticateMiddleware({ auth, resolver: freeResolver }))
    app.get('/v1/predictions/:jobId', (c) => c.json({}))

    const res = await app.request('/v1/predictions/any-job-id')
    expect(res.status).toBe(401)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Bearer-token auth (better-auth apiKey plugin)
// ────────────────────────────────────────────────────────────────────────────

interface VerifyOk {
  valid: true
  error: null
  key: { referenceId: string }
}
interface VerifyErr {
  valid: false
  error: { code: string; message: string }
  key: null
}

function makeAuthWithKey(
  verify: VerifyOk | VerifyErr | Error,
  session: { user: { id: string; email: string; role?: string } } | null = null,
): Auth {
  return {
    api: {
      getSession: vi
        .fn()
        .mockResolvedValue(
          session ? { session: {}, user: session.user } : null,
        ),
      verifyApiKey:
        verify instanceof Error
          ? vi.fn().mockRejectedValue(verify)
          : vi.fn().mockResolvedValue(verify),
    },
  } as unknown as Auth
}

function makeUserDirectory(
  user: UserRecord | null,
): UserDirectory & { getUser: ReturnType<typeof vi.fn> } {
  return {
    getUser: vi.fn().mockResolvedValue(user),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

describe('createAuthenticateMiddleware — Bearer token (apiKey plugin)', () => {
  it('valid Bearer → resolves user, sets auth context, never consults cookie', async () => {
    const auth = makeAuthWithKey({
      valid: true,
      error: null,
      key: { referenceId: 'user-abc' },
    })
    const userDirectory = makeUserDirectory({
      id: 'user-abc',
      email: 'abc@example.com',
      plan: 'pro',
    })
    const app = new Hono<{ Variables: Variables }>()
    app.use(
      '*',
      createAuthenticateMiddleware({
        auth,
        resolver: proResolver,
        userDirectory,
      }),
    )
    app.get('/test', (c) => c.json(c.get('auth')))

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer my-real-key' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      sub: string
      email: string
      plan: string
      method: string
    }
    expect(body.sub).toBe('user-abc')
    expect(body.email).toBe('abc@example.com')
    expect(body.plan).toBe('pro')
    expect(body.method).toBe('api-key')
    expect(auth.api.getSession).not.toHaveBeenCalled()
  })

  it('expired Bearer (valid:false KEY_EXPIRED) → 401, no cookie fallback', async () => {
    const auth = makeAuthWithKey(
      {
        valid: false,
        error: { code: 'KEY_EXPIRED', message: 'API key has expired' },
        key: null,
      },
      { user: { id: 'cookie-user', email: 'c@example.com' } },
    )
    const userDirectory = makeUserDirectory(null)
    const app = new Hono<{ Variables: Variables }>()
    app.use(
      '*',
      createAuthenticateMiddleware({
        auth,
        resolver: freeResolver,
        userDirectory,
      }),
    )
    app.get('/test', (c) => c.json(c.get('auth')))

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer expired-key' },
    })
    expect(res.status).toBe(401)
    expect(auth.api.getSession).not.toHaveBeenCalled()
  })

  it('revoked / disabled Bearer → 401, no cookie fallback', async () => {
    const auth = makeAuthWithKey(
      {
        valid: false,
        error: { code: 'KEY_DISABLED', message: 'API key is disabled' },
        key: null,
      },
      { user: { id: 'cookie-user', email: 'c@example.com' } },
    )
    const userDirectory = makeUserDirectory(null)
    const app = new Hono<{ Variables: Variables }>()
    app.use(
      '*',
      createAuthenticateMiddleware({
        auth,
        resolver: freeResolver,
        userDirectory,
      }),
    )
    app.get('/test', (c) => c.json({}))

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer revoked-key' },
    })
    expect(res.status).toBe(401)
    expect(auth.api.getSession).not.toHaveBeenCalled()
  })

  it('unknown Bearer (KEY_NOT_FOUND) → 401, no cookie fallback', async () => {
    const auth = makeAuthWithKey(
      {
        valid: false,
        error: { code: 'KEY_NOT_FOUND', message: 'Invalid API key' },
        key: null,
      },
      { user: { id: 'cookie-user', email: 'c@example.com' } },
    )
    const userDirectory = makeUserDirectory(null)
    const app = new Hono<{ Variables: Variables }>()
    app.use(
      '*',
      createAuthenticateMiddleware({
        auth,
        resolver: freeResolver,
        userDirectory,
      }),
    )
    app.get('/test', (c) => c.json({}))

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer unknown-key' },
    })
    expect(res.status).toBe(401)
    expect(auth.api.getSession).not.toHaveBeenCalled()
  })

  it('verifyApiKey throws → 401, no cookie fallback', async () => {
    const auth = makeAuthWithKey(new Error('verify exploded'), {
      user: { id: 'cookie-user', email: 'c@example.com' },
    })
    const userDirectory = makeUserDirectory(null)
    const app = new Hono<{ Variables: Variables }>()
    app.use(
      '*',
      createAuthenticateMiddleware({
        auth,
        resolver: freeResolver,
        userDirectory,
      }),
    )
    app.get('/test', (c) => c.json({}))

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer key-causing-throw' },
    })
    expect(res.status).toBe(401)
    expect(auth.api.getSession).not.toHaveBeenCalled()
  })

  it('malformed Authorization header → falls through to cookie session', async () => {
    const auth = makeAuthWithKey(new Error('should not be called'), {
      user: { id: 'cookie-user', email: 'c@example.com' },
    })
    const userDirectory = makeUserDirectory(null)
    const app = new Hono<{ Variables: Variables }>()
    app.use(
      '*',
      createAuthenticateMiddleware({
        auth,
        resolver: proResolver,
        userDirectory,
      }),
    )
    app.get('/test', (c) => c.json(c.get('auth')))

    const res = await app.request('/test', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    })
    expect(res.status).toBe(200)
    expect(auth.api.verifyApiKey).not.toHaveBeenCalled()
    expect(auth.api.getSession).toHaveBeenCalled()
    const body = (await res.json()) as { sub: string }
    expect(body.sub).toBe('cookie-user')
  })

  it('valid Bearer + valid cookie → Bearer wins', async () => {
    const auth = makeAuthWithKey(
      {
        valid: true,
        error: null,
        key: { referenceId: 'bearer-user' },
      },
      { user: { id: 'cookie-user', email: 'c@example.com' } },
    )
    const userDirectory = makeUserDirectory({
      id: 'bearer-user',
      email: 'bearer@example.com',
      plan: 'free',
    })
    const app = new Hono<{ Variables: Variables }>()
    app.use(
      '*',
      createAuthenticateMiddleware({
        auth,
        resolver: freeResolver,
        userDirectory,
      }),
    )
    app.get('/test', (c) => c.json(c.get('auth')))

    const res = await app.request('/test', {
      headers: {
        Authorization: 'Bearer the-key',
        Cookie: 'better-auth.session_token=anything',
      },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { sub: string; email: string }
    expect(body.sub).toBe('bearer-user')
    expect(body.email).toBe('bearer@example.com')
    expect(auth.api.getSession).not.toHaveBeenCalled()
  })

  it('Bearer path does not consume the request body', async () => {
    const auth = makeAuthWithKey({
      valid: true,
      error: null,
      key: { referenceId: 'user-abc' },
    })
    const userDirectory = makeUserDirectory({
      id: 'user-abc',
      email: 'abc@example.com',
      plan: 'free',
    })
    const app = new Hono<{ Variables: Variables }>()
    app.use(
      '*',
      createAuthenticateMiddleware({
        auth,
        resolver: freeResolver,
        userDirectory,
      }),
    )
    app.post('/test', async (c) => {
      const body: unknown = await c.req.json()
      return c.json({ echo: body })
    })

    const payload = { sequence: 'MEEPQ', extra: 42 }
    const res = await app.request('/test', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer my-key',
      },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { echo: typeof payload }
    expect(body.echo).toEqual(payload)
  })

  it('valid Bearer with admin user role → role propagated to AuthContext', async () => {
    const auth = makeAuthWithKey({
      valid: true,
      error: null,
      key: { referenceId: 'admin-user' },
    })
    const userDirectory = makeUserDirectory({
      id: 'admin-user',
      email: 'admin@example.com',
      plan: 'pro',
      role: 'admin',
    })
    const app = new Hono<{ Variables: Variables }>()
    app.use(
      '*',
      createAuthenticateMiddleware({
        auth,
        resolver: proResolver,
        userDirectory,
      }),
    )
    app.get('/test', (c) => c.json(c.get('auth')))

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer admin-key' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { role?: string }
    expect(body.role).toBe('admin')
  })
})
