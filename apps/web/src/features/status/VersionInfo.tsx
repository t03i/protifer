import { useGatewayVersion } from './useGatewayVersion'
import type { VersionSkew } from './version'
import { compareSha, frontendSha, shortSha } from './version'

import { cn } from '#/lib/utils'

const SKEW_CLASS: Record<VersionSkew, string> = {
  match: 'text-green-600',
  mismatch: 'text-yellow-600',
  unknown: 'text-muted-foreground',
}

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
