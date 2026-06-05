export type ServiceKind =
  | 'operational'
  | 'connection-lost'
  | 'degraded'
  | 'maintenance'
  | 'down'

export interface ServiceStatus {
  kind: ServiceKind
  detail?: string
}

// Better Stack public status JSON shape — all fields optional for defensive typing
export type BetterStackResourceStatus =
  | 'operational'
  | 'degraded'
  | 'down'
  | 'maintenance'

export interface BetterStackResource {
  id?: string
  name?: string
  status?: BetterStackResourceStatus
}

export interface BetterStackStatusReport {
  id?: string
  status?: string
  message?: string
}

export interface BetterStackStatusResponse {
  status_reports?: BetterStackStatusReport[]
  resources?: BetterStackResource[]
}
