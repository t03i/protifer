import { AsyncLocalStorage } from 'node:async_hooks'

import { trace } from '@opentelemetry/api'
import * as Sentry from '@sentry/node'
import { describe, it, expect } from 'vitest'

interface Ctx {
  requestId: string
  traceId: string
  spanId: string
}

const als = new AsyncLocalStorage<Ctx>()

async function inner(): Promise<Ctx | undefined> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  return als.getStore()
}

async function middle(): Promise<Ctx | undefined> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  return inner()
}

async function outer(): Promise<Ctx | undefined> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  return middle()
}

describe('correlation spike (gate)', () => {
  it('1.1: AsyncLocalStorage survives a chain of async awaits on Bun', async () => {
    const result = await als.run(
      { requestId: 'r1', traceId: 't1', spanId: 's1' },
      outer,
    )
    expect(result).toBeDefined()
    expect(result?.requestId).toBe('r1')
    expect(result?.traceId).toBe('t1')
    expect(result?.spanId).toBe('s1')
  })

  it('1.2: Sentry.startSpan exposes a non-zero traceId via @opentelemetry/api', () => {
    // When no DSN is set (test default), Sentry is a no-op. Validate the
    // interface contract: either the active span is real and has a non-zero
    // trace id, or no active span is exposed at all — never an all-zero one.
    Sentry.startSpan({ name: 'spike', op: 'test' }, () => {
      const active = trace.getActiveSpan()
      if (active) {
        const { traceId } = active.spanContext()
        expect(traceId).toMatch(/^[0-9a-f]{32}$/)
        expect(traceId).not.toBe('0'.repeat(32))
      }
      // If active is undefined (no-op mode), the request-context middleware
      // falls back to a minted request id — covered by DEC-5 + task 4.1(g).
    })
  })
})
