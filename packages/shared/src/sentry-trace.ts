import * as Sentry from '@sentry/node'

export interface SentryTraceHeaders {
  'sentry-trace': string
  baggage: string
}

/**
 * Capture the current active span's trace headers for propagation across the
 * BullMQ queue boundary. Returns `undefined` when no active span exists (no
 * Sentry DSN configured, or no request-scoped span) so callers can attach the
 * field conditionally without shipping empty strings downstream.
 */
export function captureSentryTraceHeaders(): SentryTraceHeaders | undefined {
  const span = Sentry.getActiveSpan()
  if (!span) return undefined
  const sentryTrace = Sentry.spanToTraceHeader(span)
  const baggage = Sentry.spanToBaggageHeader(span)
  if (!sentryTrace || !baggage) return undefined
  return { 'sentry-trace': sentryTrace, baggage }
}
