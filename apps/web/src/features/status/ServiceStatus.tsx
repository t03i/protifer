import type { ServiceKind } from './types'
import { useServiceStatus } from './useServiceStatus'

import { cn } from '#/lib/utils'

const STATUS_CONFIG: Record<
  ServiceKind,
  { dot: string; banner: string | null; text: string | null }
> = {
  operational: {
    dot: 'bg-green-500',
    banner: null,
    text: null,
  },
  'connection-lost': {
    dot: 'bg-red-500 animate-pulse',
    banner: 'bg-red-600 text-white',
    text: 'Connection lost — retrying…',
  },
  degraded: {
    dot: 'bg-yellow-500',
    banner: 'bg-yellow-500 text-black',
    text: 'Some services are degraded.',
  },
  maintenance: {
    dot: 'bg-blue-500',
    banner: 'bg-blue-600 text-white',
    text: 'Scheduled maintenance in progress.',
  },
  down: {
    dot: 'bg-red-500',
    banner: 'bg-red-700 text-white',
    text: 'Service is currently down.',
  },
  // Neutral: status unverified (no working status signal). Quiet grey dot,
  // no alarming banner — but explicitly not the green "operational" state.
  unknown: {
    dot: 'bg-gray-400',
    banner: null,
    text: null,
  },
}

/** Small dot indicator placed in the header nav bar. */
export function ServiceStatusDot() {
  const { kind } = useServiceStatus()
  const cfg = STATUS_CONFIG[kind]
  return (
    <span
      aria-label={`Service status: ${kind}`}
      title={kind}
      className={cn('inline-block size-2 rounded-full', cfg.dot)}
    />
  )
}

/** Full-width banner placed between the header and main content. */
export function ServiceStatusBanner() {
  const { kind } = useServiceStatus()
  const cfg = STATUS_CONFIG[kind]

  if (!cfg.banner || !cfg.text) return null

  const statusPageUrl = import.meta.env['VITE_STATUS_PAGE_URL'] as
    | string
    | undefined

  const canLink = Boolean(statusPageUrl) && kind !== 'connection-lost'

  const inner = (
    <p className="text-sm font-medium">
      {cfg.text}
      {canLink && (
        <span className="ml-1 underline underline-offset-2">
          View status page
        </span>
      )}
    </p>
  )

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('w-full px-4 py-2 text-center', cfg.banner)}
    >
      {canLink ? (
        <a
          href={statusPageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:opacity-90"
        >
          {inner}
        </a>
      ) : (
        inner
      )}
    </div>
  )
}
