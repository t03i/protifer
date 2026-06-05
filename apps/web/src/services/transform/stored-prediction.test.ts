import type { StoredPrediction } from '@protifer/shared'
import { describe, expect, it } from 'vitest'

import { transformStoredPrediction } from './stored-prediction.ts'

// V2 fixture uses the TmbedOutput shape and b/- binding alphabet.
const fullStored: StoredPrediction = {
  schemaVersion: 2,
  versions: [],
  outputs: {
    prott5_secondary_structure: { dssp3: 'HHCCEE', dssp8: 'HHBSSEE' },
    tmbed: {
      labels: 'oooooTTToo',
      probabilities: Array.from({ length: 10 }, () => [
        0.2, 0.2, 0.2, 0.2, 0.2,
      ]),
    },
    seth: [0.85, 0.85, 0.85, 0.85, 0.05, 0.05, 0.05, 0.05, 0.05],
    bindembed: { metal: 'bb--', nucleicAcids: 'bb--', smallMolecules: 'bb--' },
    prott5_conservation: [0.1, 0.9, 0.5],
    light_attention_subcellular: 'Cytoplasm',
    light_attention_membrane: 'TMhelix',
  },
}

describe('transformStoredPrediction', () => {
  it('maps all fields from a full StoredPrediction', () => {
    const result = transformStoredPrediction(fullStored)

    expect(result.predictedDSSP3).toBe('HHCCEE')
    expect(result.predictedDSSP8).toBe('HHBSSEE')
    expect(result.predictedTransmembrane).toBe('oooooTTToo')
    expect(result.predictedDisorder).toEqual([
      0.85, 0.85, 0.85, 0.85, 0.05, 0.05, 0.05, 0.05, 0.05,
    ])
    expect(result.predictedBindingMetal).toBe('bb--')
    expect(result.predictedBindingNucleicAcids).toBe('bb--')
    expect(result.predictedBindingSmallMolecules).toBe('bb--')
    expect(result.predictedTmbedProbabilities).toHaveLength(10)
    expect(result.predictedTmbedProbabilities[0]).toHaveLength(5)
    expect(result.predictedConservation).toEqual([0.1, 0.9, 0.5])
    expect(result.predictedSubcellularLocalizations).toBe('Cytoplasm')
    expect(result.predictedMembrane).toBe('TMhelix')
  })

  it('returns empty sentinels when outputs are absent', () => {
    const empty: StoredPrediction = {
      schemaVersion: 1,
      versions: [],
      outputs: {},
    }
    const result = transformStoredPrediction(empty)

    expect(result.predictedDSSP3).toBe('')
    expect(result.predictedDSSP8).toBe('')
    expect(result.predictedTransmembrane).toBe('')
    expect(result.predictedDisorder).toEqual([])
    expect(result.predictedBindingMetal).toBe('')
    expect(result.predictedBindingNucleicAcids).toBe('')
    expect(result.predictedBindingSmallMolecules).toBe('')
    expect(result.predictedConservation).toEqual([])
    expect(result.predictedSubcellularLocalizations).toBe('')
    expect(result.predictedMembrane).toBe('')
  })

  it('returns empty VariantMatrix sentinel for predictedVariation', () => {
    const result = transformStoredPrediction(fullStored)
    expect(result.predictedVariation).toEqual({
      x_axis: [],
      y_axis: [],
      values: [],
    })
  })

  it('handles partial outputs (only secondary structure present)', () => {
    const partial: StoredPrediction = {
      schemaVersion: 1,
      versions: [],
      outputs: {
        prott5_secondary_structure: { dssp3: 'HHH', dssp8: 'HHH' },
      },
    }
    const result = transformStoredPrediction(partial)
    expect(result.predictedDSSP3).toBe('HHH')
    expect(result.predictedTransmembrane).toBe('')
  })
})

describe('transformStoredPrediction - variation and macroEffect', () => {
  const BASE_STORED: StoredPrediction = {
    schemaVersion: 1,
    versions: [],
    outputs: {
      prott5_secondary_structure: { dssp3: 'HCC', dssp8: 'HCC' },
      tmbed: {
        labels: 'iii',
        probabilities: [
          [0.2, 0.2, 0.2, 0.2, 0.2],
          [0.2, 0.2, 0.2, 0.2, 0.2],
          [0.2, 0.2, 0.2, 0.2, 0.2],
        ],
      },
      seth: [0.05, 0.85, 0.35],
      bindembed: { metal: '---', nucleicAcids: '---', smallMolecules: '---' },
      prott5_conservation: [8, 7, 6],
      light_attention_subcellular: 'Cell-Membrane',
      light_attention_membrane: 'Membrane bound',
      variation: {
        x_axis: ['M', 'G', 'D'],
        y_axis: [
          'A',
          'L',
          'G',
          'V',
          'S',
          'R',
          'E',
          'D',
          'T',
          'I',
          'P',
          'K',
          'F',
          'Q',
          'N',
          'Y',
          'M',
          'H',
          'W',
          'C',
        ],
        values: [
          [10, 20, 30],
          [20, 30, 40],
          [30, 40, 50],
          [40, 50, 60],
          [50, 60, 70],
          [60, 70, 80],
          [70, 80, 90],
          [80, 90, 100],
          [10, 20, 30],
          [20, 30, 40],
          [30, 40, 50],
          [40, 50, 60],
          [50, 60, 70],
          [60, 70, 80],
          [70, 80, 90],
          [80, 90, 100],
          [10, 20, 30],
          [20, 30, 40],
          [30, 40, 50],
          [40, 50, 60],
        ],
      },
    },
  }

  it('predictedDisorder maps seth number[] directly', () => {
    const result = transformStoredPrediction(BASE_STORED)
    expect(result.predictedDisorder).toEqual([0.05, 0.85, 0.35])
  })

  it('predictedMacroEffectScore is the column-wise mean of variation values', () => {
    const result = transformStoredPrediction(BASE_STORED)
    // col means: col0=41, then +10 per col → 51, 61
    expect(result.predictedMacroEffectScore[0]).toBeCloseTo(41, 0)
    expect(result.predictedMacroEffectScore[1]).toBeCloseTo(51, 0)
    expect(result.predictedMacroEffectScore[2]).toBeCloseTo(61, 0)
  })

  it('predictedMacroEffectScore defaults to [] when variation is absent', () => {
    const stored: StoredPrediction = {
      schemaVersion: 1,
      versions: [],
      outputs: {},
    }
    const result = transformStoredPrediction(stored)
    expect(result.predictedMacroEffectScore).toEqual([])
  })

  it('predictedVariation maps o.variation when present', () => {
    const result = transformStoredPrediction(BASE_STORED)
    expect(result.predictedVariation.x_axis).toEqual(['M', 'G', 'D'])
    expect(result.predictedVariation.y_axis).toHaveLength(20)
    expect(result.predictedVariation.values).toHaveLength(20)
  })

  it('predictedVariation defaults to empty matrix when variation is absent', () => {
    const stored: StoredPrediction = {
      schemaVersion: 1,
      versions: [],
      outputs: {},
    }
    const result = transformStoredPrediction(stored)
    expect(result.predictedVariation).toEqual({
      x_axis: [],
      y_axis: [],
      values: [],
    })
  })
})

describe('transformStoredPrediction — V1/V2 tmbed branching (Phase 21-08)', () => {
  it('V1 legacy: tmbed stored as a string → predictedTransmembrane passes through, probabilities empty', () => {
    // The type layer models tmbed as TmbedOutput for both unions, so cast
    // through unknown to simulate the legacy V1 string record shape.
    const storedV1 = {
      schemaVersion: 1 as const,
      versions: [],
      outputs: { tmbed: 'iiiioooo' },
    } as unknown as StoredPrediction
    const result = transformStoredPrediction(storedV1)
    expect(result.predictedTransmembrane).toBe('iiiioooo')
    expect(result.predictedTmbedProbabilities).toEqual([])
  })

  it('V2 new: tmbed as { labels, probabilities } → branches to labels', () => {
    const storedV2: StoredPrediction = {
      schemaVersion: 2,
      versions: [],
      outputs: {
        tmbed: {
          labels: 'HHBBii',
          probabilities: [
            [0.1, 0.2, 0.3, 0.2, 0.2],
            [0.1, 0.2, 0.3, 0.2, 0.2],
            [0.1, 0.2, 0.3, 0.2, 0.2],
            [0.1, 0.2, 0.3, 0.2, 0.2],
            [0.1, 0.2, 0.3, 0.2, 0.2],
            [0.1, 0.2, 0.3, 0.2, 0.2],
          ],
        },
      },
    }
    const result = transformStoredPrediction(storedV2)
    expect(result.predictedTransmembrane).toBe('HHBBii')
    expect(result.predictedTmbedProbabilities).toHaveLength(6)
    expect(result.predictedTmbedProbabilities[0]).toHaveLength(5)
  })

  it('V2 new with tmbed undefined → empty string + empty probabilities', () => {
    const storedV2: StoredPrediction = {
      schemaVersion: 2,
      versions: [],
      outputs: {},
    }
    const result = transformStoredPrediction(storedV2)
    expect(result.predictedTransmembrane).toBe('')
    expect(result.predictedTmbedProbabilities).toEqual([])
  })
})
