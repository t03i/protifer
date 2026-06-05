import { OpenAPIHono } from '@hono/zod-openapi'
import type { PlanResolver } from '@protifer/shared'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { createFoldseekRouter } from './foldseek.ts'
import type { Auth } from '../auth/index.ts'
import { createAuthenticateMiddleware } from '../middleware/auth/index.ts'
import type { Variables } from '../types/hono.ts'

const proResolver: PlanResolver = { resolve: vi.fn().mockResolvedValue('pro') }

const mockAuth = {
  api: {
    getSession: vi.fn().mockResolvedValue({
      session: {},
      user: { id: 'user-001', email: 'user@example.com' },
    }),
  },
} as unknown as Auth

const ALLOWED_URL =
  'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.cif'

function makeApp() {
  const app = new OpenAPIHono<{ Variables: Variables }>()
  app.use(
    '*',
    createAuthenticateMiddleware({ auth: mockAuth, resolver: proResolver }),
  )
  app.route('/v1/foldseek', createFoldseekRouter())
  return app
}

function submit(body: unknown) {
  return makeApp().request('/v1/foldseek', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Request-User': 'u1',
      'X-Auth-Request-Email': 'u@test.com',
    },
    body: JSON.stringify(body),
  })
}

describe('POST /v1/foldseek', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('rejects a redirect to a disallowed (internal) host with 502', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Response(null, {
            status: 302,
            headers: { Location: 'http://127.0.0.1/latest/meta-data/' },
          }),
      ),
    )

    const res = await submit({ model_url: ALLOWED_URL })
    expect(res.status).toBe(502)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toMatch(/Failed to download/)
  })

  it('rejects a streamed body over the size cap (no content-length) with 400', async () => {
    const chunk = new Uint8Array(6 * 1024 * 1024) // 6MB
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk)
        controller.enqueue(chunk) // 12MB total > 10MB cap
        controller.close()
      },
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(stream, { status: 200 })),
    )

    const res = await submit({ model_url: ALLOWED_URL })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toMatch(/too large/)
  })

  it('forwards to Foldseek and returns a ticket on the happy path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (input.includes('search.foldseek.com')) {
          return new Response(JSON.stringify({ id: 'ticket-xyz' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      }),
    )

    const res = await submit({ model_url: ALLOWED_URL, databases: ['pdb100'] })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ticketId).toBe('ticket-xyz')
  })
})
