import { useGatewayVersion } from './useGatewayVersion'
import type { VersionSkew } from './version'
import { compareSha, frontendSha, shortSha } from './version'

import { cn } from '#/lib/utils'

const SKEW_CLASS: Record<VersionSkew, string> = {
  match: 'text-green-600',
  mismatch: 'text-yellow-600',
  unknown: 'text-muted-foreground',
}

/**
 * Quiet diagnostics line for the footer: shows the frontend and backend build
 * SHAs side by side, coloured by whether they match. Copy-pasteable into bug
 * reports. Transient skew during a rollout is expected — never an error state.
 */
export function VersionInfo() {
  const fe = frontendSha()
  const { data: be } = useGatewayVersion()
  const skew = compareSha(fe, be)

  return (
    <p
      className={cn('font-mono', SKEW_CLASS[skew])}
      title={`frontend ${fe} · backend ${be ?? 'unknown'}`}
    >
      {skew === 'mismatch' && <span aria-hidden="true">⚠ </span>}
      fe {shortSha(fe)} · be {shortSha(be ?? 'unknown')}
    </p>
  )
}
