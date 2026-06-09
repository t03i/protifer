export type ServiceKind =
  | 'operational'
  | 'connection-lost'
  | 'degraded'
  | 'maintenance'
  | 'down'
  // Neutral fallback: no positive health signal available (e.g. status page
  // unconfigured/unreachable). We must NOT assume operational in this case.
  | 'unknown'

export interface ServiceStatus {
  kind: ServiceKind
  detail?: string
}

// Better Stack public status JSON (`<status-page-url>/index.json`).
// JSON:API document; overall status lives in data.attributes.aggregate_state.
// All fields optional for defensive parsing. Note Better Stack uses
// "downtime" where our ServiceKind uses "down".
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
