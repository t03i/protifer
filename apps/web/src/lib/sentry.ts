import * as Sentry from '@sentry/react'
import type { ErrorEvent, EventHint } from '@sentry/react'

let initialised = false

/** Redact values under any key that looks like a sequence input. */
const SEQUENCE_KEY = /seq|fasta|sequence/i

function stripQuery(url: unknown): unknown {
  if (typeof url !== 'string') return url
  const q = url.indexOf('?')
  return q === -1 ? url : url.slice(0, q)
}

function scrubRecord(data: Record<string, unknown>): void {
  for (const key of Object.keys(data)) {
    if (SEQUENCE_KEY.test(key)) data[key] = '[Filtered]'
    else if (key === 'url') data[key] = stripQuery(data[key])
  }
}

/**
 * Layer-2 scrub (Decision 5): strip query strings and sequence-input field
 * values before an event leaves the browser. The server-side `relayPiiConfig`
 * (`infra/observability/sentry-pii.json`) is the ingest-time net behind this.
 */
function beforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent {
  if (event.request) {
    event.request.url = stripQuery(event.request.url) as string | undefined
    event.request.query_string = undefined
    if (event.request.data && typeof event.request.data === 'object') {
      scrubRecord(event.request.data as Record<string, unknown>)
    }
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.data) scrubRecord(crumb.data)
  }
  return event
}

/**
 * Browser analog of the backend `initSentry()` (`packages/shared/src/sentry.ts`).
 * No-op when `VITE_SENTRY_DSN` is empty (the dev/test default and primary kill
 * switch); idempotent so HMR re-runs don't re-init.
 */
export function initFrontendSentry(): void {
  if (initialised) return
  initialised = true

  const dsn = import.meta.env['VITE_SENTRY_DSN']
  if (!dsn) return

  const gitSha = import.meta.env['VITE_GIT_SHA']
  if (!gitSha) {
    console.warn(
      'VITE_GIT_SHA not set — Sentry events tagged release="unknown"',
    )
  }
  const isProd = import.meta.env.MODE === 'production'

  Sentry.init({
    dsn,
    release: gitSha ?? 'unknown',
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    tracesSampleRate: isProd ? 0.2 : 1.0,
    integrations: [
      Sentry.browserTracingIntegration({
        // Only gateway-origin requests carry sentry-trace/baggage (Decision 4).
        // The gateway continues the span into workers via `_sentryTrace`.
      }),
    ],
    tracePropagationTargets: [import.meta.env['VITE_GATEWAY_URL'] ?? ''].filter(
      Boolean,
    ),
    initialScope: { tags: { service: 'web' } },
    beforeSend,
  })
}
