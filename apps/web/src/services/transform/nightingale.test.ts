import { describe, expect, it } from 'vitest'

import { toNightingaleData } from './nightingale'
import { toHeatmapData, toVariationData } from './variation'

import type { PredictionResponse, VariantMatrix } from '#/types/features'

const predictions: PredictionResponse = {
  predictedDSSP3: 'HHC',
  predictedDSSP8: 'HHC',
  predictedTransmembrane: 'ooo',
  predictedTmbedProbabilities: [],
  predictedDisorder: [0.05, 0.05, 0.05],
  predictedBindingMetal: '---',
  predictedBindingNucleicAcids: '---',
  predictedBindingSmallMolecules: '---',
  predictedConservation: [0.1, 0.9, 0.5],
  predictedMacroEffectScore: [],
  predictedVariation: { x_axis: [], y_axis: [], values: [] },
  predictedSubcellularLocalizations: 'Cytoplasm',
  predictedMembrane: 'TMhelix',
}

describe('toNightingaleData', () => {
  it('conservation is LineData[] with name, range, and values', () => {
    const result = toNightingaleData(predictions)

    expect(Array.isArray(result.conservation)).toBe(true)
    expect(result.conservation).toHaveLength(1)

    const [line] = result.conservation
    if (!line) throw new Error('expected a LineData entry')
    expect(line.name).toBeDefined()
    expect(Array.isArray(line.range)).toBe(true)
    expect(line.range.length).toBeGreaterThan(0)
    expect(Array.isArray(line.values)).toBe(true)
    expect(line.values).toHaveLength(3)
    expect(line.values[0]).toEqual({ position: 1, value: 0.1 })
    expect(line.values[1]).toEqual({ position: 2, value: 0.9 })
    expect(line.values[2]).toEqual({ position: 3, value: 0.5 })
  })

  it('conservation range covers 0 to 9 for valid conservation scores', () => {
    const result = toNightingaleData(predictions)
    const [line] = result.conservation
    if (!line) throw new Error('expected a LineData entry')
    expect(line.range).toContain(0)
    expect(line.range).toContain(9)
  })

  it('macroEffect is LineData[] with correct values and range [0, 100]', () => {
    const predictionsWithMacroEffect: PredictionResponse = {
      ...predictions,
      predictedMacroEffectScore: [50, 75, 25],
    }
    const result = toNightingaleData(predictionsWithMacroEffect)

    expect(Array.isArray(result.macroEffect)).toBe(true)
    expect(result.macroEffect).toHaveLength(1)

    const [line] = result.macroEffect
    if (!line) throw new Error('expected a LineData entry')
    expect(Array.isArray(line.values)).toBe(true)
    expect(line.values).toHaveLength(3)
    expect(line.values[0]).toEqual({ position: 1, value: 50 })
    expect(line.values[1]).toEqual({ position: 2, value: 75 })
    expect(line.values[2]).toEqual({ position: 3, value: 25 })
    expect(line.range).toContain(0)
    expect(line.range).toContain(200)
  })

  it('dssp3 features have correct accession and positions', () => {
    const result = toNightingaleData(predictions)
    const accessions = result.dssp3.map((f) => f.accession)
    expect(accessions).toContain('H')
    expect(accessions).toContain('C')
  })

  it('dssp3 features have spec-compliant tooltipContent', () => {
    const pred: PredictionResponse = {
      ...predictions,
      predictedDSSP3: 'HEC',
    }
    const result = toNightingaleData(pred)
    const helix = result.dssp3.find((f) => f.accession === 'H')
    const sheet = result.dssp3.find((f) => f.accession === 'E')
    const other = result.dssp3.find((f) => f.accession === 'C')
    expect(helix?.tooltipContent).toBe('Helix')
    expect(sheet?.tooltipContent).toBe('Sheet')
    expect(other?.tooltipContent).toBe('Other')
  })

  it('transmembrane features have F4-alphabet tooltipContent (Phase 21)', () => {
    const pred: PredictionResponse = {
      ...predictions,
      predictedTransmembrane: 'HhBbSio',
    }
    const result = toNightingaleData(pred)
    const labels = Object.fromEntries(
      result.transmembrane.map((f) => [f.accession, f.tooltipContent]),
    )
    expect(labels['H']).toBe('Helix – outwards')
    expect(labels['h']).toBe('Helix – inwards')
    expect(labels['B']).toBe('Sheet – outwards')
    expect(labels['b']).toBe('Sheet – inwards')
    expect(labels['S']).toBe('Signal peptide')
    expect(labels['i']).toBe('Non-membrane – inside')
    expect(labels['o']).toBe('Non-membrane – outside')
  })

  it('transmembrane no longer emits `s` features (F4 alphabet drop)', () => {
    const pred: PredictionResponse = {
      ...predictions,
      predictedTransmembrane: 'Sss',
    }
    const result = toNightingaleData(pred)
    const accessions = result.transmembrane.map((f) => f.accession)
    expect(accessions).not.toContain('s')
  })

  it('binding tracks use collapsed `b`/`-` alphabet (Phase 21)', () => {
    const pred: PredictionResponse = {
      ...predictions,
      predictedBindingMetal: 'b--',
      predictedBindingNucleicAcids: '-b-',
      predictedBindingSmallMolecules: '--b',
    }
    const result = toNightingaleData(pred)
    expect(result.bindingMetal).toHaveLength(1)
    expect(result.bindingNucleicAcids).toHaveLength(1)
    expect(result.bindingSmallMolecules).toHaveLength(1)
    expect(result.bindingMetal[0]!.shape).toBe('circle')
    expect(result.bindingNucleicAcids[0]!.shape).toBe('circle')
    expect(result.bindingSmallMolecules[0]!.shape).toBe('circle')
  })

  it('binding tooltipContent is unified "Binding residue" across all three tracks', () => {
    const pred: PredictionResponse = {
      ...predictions,
      predictedBindingMetal: 'b--',
      predictedBindingNucleicAcids: '-b-',
      predictedBindingSmallMolecules: '--b',
    }
    const result = toNightingaleData(pred)
    expect(result.bindingMetal[0]!.tooltipContent).toBe('Binding residue')
    expect(result.bindingNucleicAcids[0]!.tooltipContent).toBe(
      'Binding residue',
    )
    expect(result.bindingSmallMolecules[0]!.tooltipContent).toBe(
      'Binding residue',
    )
  })

  it('binding tracks emit 3 features for `b-b-b-` pattern', () => {
    const pred: PredictionResponse = {
      ...predictions,
      predictedBindingMetal: 'b-b-b-',
    }
    const result = toNightingaleData(pred)
    expect(result.bindingMetal).toHaveLength(3)
  })

  it('disorder LineData has color #0F8292', () => {
    const result = toNightingaleData(predictions)
    const [line] = result.disorder
    expect(line?.color).toBe('#0F8292')
  })

  it('macroEffect LineData has range [0, 200] and color #00babd', () => {
    const pred: PredictionResponse = {
      ...predictions,
      predictedMacroEffectScore: [100],
    }
    const result = toNightingaleData(pred)
    const [line] = result.macroEffect
    expect(line?.range).toEqual([0, 200])
    expect(line?.color).toBe('#00babd')
  })
})

describe('toNightingaleData — defensive guards', () => {
  it('returns empty disorder when predictedDisorder is a string', () => {
    const pred: PredictionResponse = {
      ...predictions,
      predictedDisorder: 'XXXXX---' as unknown as number[],
    }
    const result = toNightingaleData(pred)
    expect(result.disorder[0]!.values).toHaveLength(0)
  })

  it('returns empty macroEffect when predictedMacroEffectScore is undefined', () => {
    const pred: PredictionResponse = {
      ...predictions,
      predictedMacroEffectScore: undefined as unknown as number[],
    }
    const result = toNightingaleData(pred)
    expect(result.macroEffect[0]!.values).toHaveLength(0)
  })

  it('other tracks still work when disorder/macroEffect are broken', () => {
    const pred: PredictionResponse = {
      ...predictions,
      predictedTransmembrane: 'HHo',
      predictedDisorder: 'XXX' as unknown as number[],
      predictedMacroEffectScore: undefined as unknown as number[],
    }
    const result = toNightingaleData(pred)
    expect(result.transmembrane.length).toBeGreaterThan(0)
    expect(result.disorder[0]!.values).toHaveLength(0)
    expect(result.macroEffect[0]!.values).toHaveLength(0)
  })
})

describe('toVariationData', () => {
  const matrix: VariantMatrix = {
    x_axis: ['1', '2'],
    y_axis: ['A', 'G'],
    values: [
      [0, 200],
      [100, 50],
    ],
  }

  it('returns VariationData with the provided sequence', () => {
    const result = toVariationData(matrix, 'MG')
    expect(result.sequence).toBe('MG')
  })

  it('creates one variant per (position × amino acid) combination', () => {
    const result = toVariationData(matrix, 'MG')
    expect(result.variants).toHaveLength(4)
  })

  it('each variant has correct start, variant, accession', () => {
    const result = toVariationData(matrix, 'MG')
    const v = result.variants.find((d) => d.variant === 'A' && d.start === 1)!
    expect(v).toBeDefined()
    expect(v.accession).toBe('A1')
    expect(v.hasPredictions).toBe(true)
    expect(v.xrefNames).toEqual([])
  })

  it('score 0 maps to white #ffffff', () => {
    const result = toVariationData(matrix, 'MG')
    const v = result.variants.find((d) => d.variant === 'A' && d.start === 1)!
    expect(v.color!.toLowerCase()).toBe('#ffffff')
  })

  it('score 200 maps to #d44515', () => {
    const result = toVariationData(matrix, 'MG')
    const v = result.variants.find((d) => d.variant === 'A' && d.start === 2)!
    expect(v.color!.toLowerCase()).toBe('#d44515')
  })

  it('returns empty variants for empty matrix', () => {
    const empty: VariantMatrix = { x_axis: [], y_axis: [], values: [] }
    const result = toVariationData(empty, '')
    expect(result.variants).toHaveLength(0)
  })
})

describe('toHeatmapData', () => {
  it('flattens VariantMatrix into xDomain, yDomain, and data', () => {
    const matrix: VariantMatrix = {
      x_axis: ['M', 'G'],
      y_axis: ['A', 'L'],
      values: [
        [10, 200],
        [50, 0],
      ],
    }
    const result = toHeatmapData(matrix)
    expect(result.xDomain).toEqual([1, 2])
    expect(result.yDomain).toEqual(['A', 'L'])
    expect(result.data).toHaveLength(4)
    expect(
      result.data.find((d) => d.xValue === 1 && d.yValue === 'A')!.score,
    ).toBe(10)
  })
})
