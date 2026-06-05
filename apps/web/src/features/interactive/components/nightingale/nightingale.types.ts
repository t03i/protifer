export interface NightingaleFeature {
  accession: string // letter code used as feature identifier
  start: number // 1-based
  end: number // 1-based inclusive
  color?: string
  shape?: 'rectangle' | 'diamond' | 'circle' | 'arrow'
  tooltipContent?: string
}
