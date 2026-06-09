import { afterEach, describe, expect, it, vi } from 'vitest'

import { scrubAminoAcidRuns } from './sentry-scrub.ts'
import { _resetSentryForTests, initSentry } from './sentry.ts'

afterEach(() => {
  _resetSentryForTests()
})

describe('initSentry', () => {
  it('no-ops when SENTRY_DSN is empty', () => {
    const init = vi.fn()
    initSentry('api-gateway', { env: { SENTRY_DSN: '' }, init })
    expect(init).not.toHaveBeenCalled()
  })

  it('no-ops when SENTRY_DSN is unset', () => {
    const init = vi.fn()
    initSentry('api-gateway', { env: {}, init })
    expect(init).not.toHaveBeenCalled()
  })

  it('initialises with production sampling at 0.2', () => {
    const init = vi.fn()
    initSentry('api-gateway', {
      env: {
        SENTRY_DSN: 'https://key@sentry.io/1',
        NODE_ENV: 'production',
        GIT_SHA: 'abc1234',
      },
      init,
    })
    expect(init).toHaveBeenCalledOnce()
    expect(init.mock.calls[0]?.[0]).toMatchObject({
      dsn: 'https://key@sentry.io/1',
      release: 'abc1234',
      environment: 'production',
      tracesSampleRate: 0.2,
      serverName: 'api-gateway',
    })
  })

  it('defaults to full sampling outside production', () => {
    const init = vi.fn()
    initSentry('embedding-worker', {
      env: {
        SENTRY_DSN: 'https://key@sentry.io/1',
        NODE_ENV: 'development',
        GIT_SHA: 'abc1234',
      },
      init,
    })
    expect(init.mock.calls[0]?.[0]).toMatchObject({
      tracesSampleRate: 1.0,
      environment: 'development',
    })
  })

  it('falls back to release="unknown" when GIT_SHA is unset', () => {
    const init = vi.fn()
    initSentry('prediction-worker', {
      env: { SENTRY_DSN: 'https://key@sentry.io/1', NODE_ENV: 'staging' },
      init,
    })
    expect(init.mock.calls[0]?.[0]).toMatchObject({ release: 'unknown' })
  })

  it('wires scrubAminoAcidRuns as beforeSend', () => {
    const init = vi.fn()
    initSentry('api-gateway', {
      env: { SENTRY_DSN: 'https://key@sentry.io/1', GIT_SHA: 'abc' },
      init,
    })
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ beforeSend: scrubAminoAcidRuns }),
    )
  })

  it('is idempotent across calls', () => {
    const init = vi.fn()
    const env = { SENTRY_DSN: 'https://key@sentry.io/1', GIT_SHA: 'abc' }
    initSentry('svc', { env, init })
    initSentry('svc', { env, init })
    expect(init).toHaveBeenCalledOnce()
  })
})
