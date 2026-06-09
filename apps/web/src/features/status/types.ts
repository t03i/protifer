export type ServiceKind =
  | 'operational'
  | 'connection-lost'
  | 'degraded'
  | 'maintenance'
  | 'down'
  | 'unknown'

export interface ServiceStatus {
  kind: ServiceKind
  detail?: string
}

export type BetterStackAggregateState =
  | 'operational'
  | 'degraded'
  | 'downtime'
  | 'maintenance'

export interface BetterStackStatusResponse {
  data?: {
    type?: string
    attributes?: {
      aggregate_state?: BetterStackAggregateState
    }
  }
}
