import { createHash } from 'crypto'

import type { EmbeddingModelConfig, PredictionModelVersion } from './types.ts'

export function computeSequenceHash(sequence: string): string {
  return createHash('sha256').update(sequence).digest('hex')
}

export function computeModelConfigHash(
  models: PredictionModelVersion[],
): string {
  const sorted = [...models].sort((a, b) => a.name.localeCompare(b.name))
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}

export function computeEmbeddingJobId(
  sequence: string,
  embeddingModel: EmbeddingModelConfig,
): string {
  return createHash('sha256')
    .update(`${sequence}:${embeddingModel.name}:${embeddingModel.version}`)
    .digest('hex')
}

export function computePredictionJobId(
  sequence: string,
  embeddingModel: EmbeddingModelConfig,
  predictionModels: PredictionModelVersion[],
): string {
  const predHash = computeModelConfigHash(predictionModels)
  return createHash('sha256')
    .update(
      `${sequence}:${embeddingModel.name}:${embeddingModel.version}:${predHash}`,
    )
    .digest('hex')
}

export function embeddingRefKey(
  embeddingModel: EmbeddingModelConfig,
  sequenceHash: string,
): string {
  return `emb/${embeddingModel.name}/${embeddingModel.version}/${sequenceHash}`
}

export function predictionRefKey(
  embeddingModel: EmbeddingModelConfig,
  predictionModels: PredictionModelVersion[],
  sequenceHash: string,
): string {
  const predHash = computeModelConfigHash(predictionModels)
  const fullHash = createHash('sha256')
    .update(`${embeddingModel.name}:${embeddingModel.version}:${predHash}`)
    .digest('hex')
  return `pred/${fullHash}/${sequenceHash}`
}
