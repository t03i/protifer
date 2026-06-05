import type { ServiceStatus } from './types'
import { useConnectionHealth } from './useConnectionHealth'
import { useStatusPageApi } from './useStatusPageApi'

export function useServiceStatus(): ServiceStatus {
  const health = useConnectionHealth()
  const remote = useStatusPageApi()

  // Local signal takes priority — works even when status page is unreachable
  if (health === 'lost') return { kind: 'connection-lost' }

  if (remote) return { kind: remote.kind, detail: remote.detail }

  return { kind: 'operational' }
}
