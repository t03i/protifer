import type {
  VariationData,
  VariationDatum,
} from '@nightingale-elements/nightingale-variation'

import type { VariantMatrix } from '#/types/features'

export interface HeatmapDatum {
  xValue: number
  yValue: string
  score: number
}

export interface HeatmapData {
  xDomain: number[]
  yDomain: string[]
  data: HeatmapDatum[]
}

function scoreToHex(score: number, maxScore = 200): string {
  const t = Math.min(1, Math.max(0, score / maxScore))
  const r = Math.round(0xff + t * (0xd4 - 0xff))
  const g = Math.round(0xff + t * (0x45 - 0xff))
  const b = Math.round(0xff + t * (0x15 - 0xff))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export function toVariationData(
  matrix: VariantMatrix,
  sequence: string,
): VariationData {
  const variants: VariationDatum[] = []

  for (let aaIdx = 0; aaIdx < matrix.y_axis.length; aaIdx++) {
    const aaCode = matrix.y_axis[aaIdx]!
    const row = matrix.values[aaIdx]!

    for (let posIdx = 0; posIdx < matrix.x_axis.length; posIdx++) {
      const score = row[posIdx] ?? 0
      variants.push({
        accession: `${aaCode}${posIdx + 1}`,
        variant: aaCode,
        start: posIdx + 1,
        hasPredictions: true,
        // Arbitrary: nightingale-variation only uses consequenceType for colour
        // when no explicit color is given, and we always set color below.
        consequenceType: 'predicted_effect',
        xrefNames: [],
        color: scoreToHex(score),
        tooltipContent: `${aaCode} at position ${posIdx + 1}: ${score.toFixed(1)}`,
      })
    }
  }

  return { sequence, variants }
}

export function toHeatmapData(matrix: VariantMatrix): HeatmapData {
  const xDomain = matrix.x_axis.map((_, i) => i + 1)
  const yDomain = matrix.y_axis
  const data: HeatmapDatum[] = []
  for (let aa = 0; aa < matrix.y_axis.length; aa++) {
    const row = matrix.values[aa]!
    for (let pos = 0; pos < matrix.x_axis.length; pos++) {
      data.push({
        xValue: pos + 1,
        yValue: matrix.y_axis[aa]!,
        score: row[pos] ?? 0,
      })
    }
  }
  return { xDomain, yDomain, data }
}
