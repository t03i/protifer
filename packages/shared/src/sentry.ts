import * as Sentry from '@sentry/node'
import pino from 'pino'

import { defaultPinoOptions } from './logger-options.ts'

let initialised = false

export interface InitSentryOptions {
  /**
   * Override `process.env` lookup. Tests pass a fake env to avoid leaking
   * through real shell state.
   */
  env?: NodeJS.ProcessEnv
  /**
   * Injected `Sentry.init` for unit tests. Defaults to the real SDK.
   */
  init?: typeof Sentry.init
}

/**
 * Bootstrap Sentry for a backend service. Idempotent (subsequent calls are
 * no-ops), safe to call before any other module that could throw.
 *
 * Behaviour:
 * - When `SENTRY_DSN` is empty or unset, skips `Sentry.init` entirely; the
 *   SDK's call-site helpers (`captureException`, `startSpan`, ...) are then
 *   no-ops. This is the default for local dev and test runs.
 * - `release` resolves from `GIT_SHA`, falling back to `"unknown"` with one
 *   warning at startup so real deploys notice the missing env var without
 *   blocking development.
 * - `tracesSampleRate` is 0.2 in production and 1.0 elsewhere (head-based
 *   sampling keeps traces whole across the BullMQ boundary).
 */
export function initSentry(
  serviceName: string,
  opts: InitSentryOptions = {},
): void {
  if (initialised) return
  initialised = true

  const env = opts.env ?? process.env
  const init = opts.init ?? Sentry.init
  const logger = pino({ name: serviceName, ...defaultPinoOptions() })

  const dsn = env['SENTRY_DSN']
  if (!dsn) {
    logger.debug('SENTRY_DSN empty — Sentry SDK running in no-op mode')
    return
  }

  const nodeEnv = env['NODE_ENV'] ?? 'development'
  const gitSha = env['GIT_SHA']
  const release = gitSha ?? 'unknown'
  if (!gitSha) {
    logger.warn(
      'GIT_SHA not set — Sentry events will be tagged release="unknown"',
    )
  }

  init({
    dsn,
    release,
    environment: nodeEnv,
    tracesSampleRate: nodeEnv === 'production' ? 0.2 : 1.0,
    serverName: serviceName,
    initialScope: { tags: { service: serviceName } },
  })
}

/** Test-only: reset the init guard so unit tests can exercise both branches. */
export function _resetSentryForTests(): void {
  initialised = false
}
