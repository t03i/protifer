export interface FeatureRequest {
  sequence: string
  model: string
  format: string
  only_closest_k: boolean
}

export const DEFAULT_FEATURE_REQUEST_OPTIONS = {
  model: 'prottrans_t5_xl_u50',
  format: 'full',
  only_closest_k: true,
} as const
