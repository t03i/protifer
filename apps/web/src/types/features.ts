export interface VariantMatrix {
  x_axis: string[]
  y_axis: string[]
  values: number[][]
}

export interface PredictionResponse {
  predictedDSSP3: string
  predictedDSSP8: string
  predictedTransmembrane: string
  predictedTmbedProbabilities: number[][]
  predictedDisorder: number[]
  predictedBindingMetal: string
  predictedBindingNucleicAcids: string
  predictedBindingSmallMolecules: string
  predictedConservation: number[]
  predictedMacroEffectScore: number[]
  predictedVariation: VariantMatrix
  predictedSubcellularLocalizations: string
  predictedMembrane: string
}
