import type { ServiceStatus } from './types'
import { useConnectionHealth } from './useConnectionHealth'
import { useStatusPageApi } from './useStatusPageApi'

export function useServiceStatus(): ServiceStatus {
  const health = useConnectionHealth()
  const remote = useStatusPageApi()

  // Local signal takes priority — works even when status page is unreachable
  if (health === 'lost') return { kind: 'connection-lost' }

  // Status page is the source of truth when reachable.
  if (remote) return { kind: remote.kind, detail: remote.detail }

  // No positive health signal (status page unconfigured/unreachable): stay
  // neutral rather than falsely reporting operational.
  return { kind: 'unknown' }
}
