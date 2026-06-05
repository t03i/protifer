import type { StoredPrediction, VariationOutput } from '@protifer/shared'

import type { PredictionResponse, VariantMatrix } from '#/types/features.ts'

const EMPTY_VARIATION: VariantMatrix = { x_axis: [], y_axis: [], values: [] }

function computeMacroEffectScore(
  variation: VariationOutput | undefined,
): number[] {
  if (!variation || variation.values.length === 0) return []
  const seqLen = variation.x_axis.length
  const numAA = variation.values.length
  const scores: number[] = []
  for (let col = 0; col < seqLen; col++) {
    let sum = 0
    for (let row = 0; row < numAA; row++) {
      sum += variation.values[row]![col]!
    }
    scores.push(sum / numAA)
  }
  return scores
}

export function transformStoredPrediction(
  stored: StoredPrediction,
): PredictionResponse {
  const o = stored.outputs

  // tmbed shape migration: V1 records store a string, V2 store
  // `{labels, probabilities}`. Branch on typeof so legacy records keep rendering.
  const predictedTransmembrane =
    typeof o.tmbed === 'string' ? o.tmbed : (o.tmbed?.labels ?? '')
  const predictedTmbedProbabilities: number[][] =
    typeof o.tmbed === 'object' ? o.tmbed.probabilities : []

  return {
    predictedDSSP3: o.prott5_secondary_structure?.dssp3 ?? '',
    predictedDSSP8: o.prott5_secondary_structure?.dssp8 ?? '',
    predictedTransmembrane,
    predictedTmbedProbabilities,
    predictedDisorder: Array.isArray(o.seth) ? o.seth : [],
    predictedBindingMetal: o.bindembed?.metal ?? '',
    predictedBindingNucleicAcids: o.bindembed?.nucleicAcids ?? '',
    predictedBindingSmallMolecules: o.bindembed?.smallMolecules ?? '',
    predictedConservation: o.prott5_conservation ?? [],
    predictedMacroEffectScore: computeMacroEffectScore(o.variation),
    predictedVariation: o.variation ?? EMPTY_VARIATION,
    predictedSubcellularLocalizations: (
      o.light_attention_subcellular ?? ''
    ).replaceAll('-', ' '),
    predictedMembrane: o.light_attention_membrane ?? '',
  }
}
