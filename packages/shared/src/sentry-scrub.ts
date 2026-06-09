export const AMINO_ACID_RUN = /[ACDEFGHIKLMNPQRSTVWY]{20,}/g

const FILTERED = '[Filtered]'
const MAX_DEPTH = 8

// Structural, not the SDK's `ErrorEvent`: @sentry/node and @sentry/react can
// resolve to different @sentry/core versions whose nominal types don't unify.
export interface ScrubbableEvent {
  message?: string
  exception?: { values?: Array<{ value?: string }> }
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>
  request?: {
    url?: string
    // Sentry's `query_string` is `string | object | array`; only redact strings.
    query_string?: unknown
    data?: unknown
    headers?: Record<string, unknown>
  }
  extra?: Record<string, unknown>
  contexts?: Record<string, unknown>
}

function redactString(value: string): string {
  return value.replace(AMINO_ACID_RUN, FILTERED)
}

/**
 * Recursively redact amino-acid runs from every string reachable inside a
 * data container, mutating in place. Bounded depth + a seen-set guard keep it
 * safe against deep or cyclic structures.
 */
function redactDeep(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): void {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)

  if (Array.isArray(value)) {
    const arr = value as unknown[]
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      if (typeof item === 'string') arr[i] = redactString(item)
      else redactDeep(item, seen, depth + 1)
    }
    return
  }

  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    const item = record[key]
    if (typeof item === 'string') record[key] = redactString(item)
    else redactDeep(item, seen, depth + 1)
  }
}

// `beforeSend` scrub: redact ≥20-residue amino-acid runs from a Sentry event
// in place, returning it.
export function scrubAminoAcidRuns<E extends ScrubbableEvent>(event: E): E {
  const seen = new WeakSet<object>()

  if (typeof event.message === 'string') {
    event.message = redactString(event.message)
  }

  for (const value of event.exception?.values ?? []) {
    if (typeof value.value === 'string') value.value = redactString(value.value)
  }

  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.message === 'string') {
      crumb.message = redactString(crumb.message)
    }
    if (crumb.data) redactDeep(crumb.data, seen, 0)
  }

  if (event.request) {
    const { request } = event
    if (typeof request.url === 'string') request.url = redactString(request.url)
    if (typeof request.query_string === 'string') {
      request.query_string = redactString(request.query_string)
    }
    if (request.data) redactDeep(request.data, seen, 0)
    if (request.headers) redactDeep(request.headers, seen, 0)
  }

  if (event.extra) redactDeep(event.extra, seen, 0)
  if (event.contexts) redactDeep(event.contexts, seen, 0)

  return event
}
