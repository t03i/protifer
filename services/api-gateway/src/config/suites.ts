import type { ModelInventory, PredictionSuiteConfig } from '@protifer/shared'
import {
  EMBEDDING_MODELS,
  PREDICTION_MODELS,
  fetchModelInventoryFromOci,
  loadModelInventoryFromFile,
} from '@protifer/shared'

import type { Config } from './schema.ts'

const EMBEDDING_IDS = new Set<string>(EMBEDDING_MODELS)
const PREDICTION_IDS = new Set<string>(PREDICTION_MODELS)

/**
 * Build the served suite from the artifact inventory. `internal` entries are
 * excluded (Triton serves them, the gateway ignores them); every surfaced `id`
 * must be a known model — unknown ids fail fast at boot (Decision 3).
 */
export function buildSuiteFromInventory(
  inventory: ModelInventory,
): PredictionSuiteConfig {
  const embeddings = inventory.models.filter((m) => m.role === 'embedding')
  if (embeddings.length !== 1) {
    throw new Error(
      `inventory must declare exactly one embedding model, found ${String(embeddings.length)}`,
    )
  }
  const embeddingId = embeddings[0]?.id
  if (embeddingId === undefined || !EMBEDDING_IDS.has(embeddingId)) {
    throw new Error(`unknown embedding model id "${String(embeddingId)}"`)
  }

  const predictionModels = inventory.models
    .filter((m) => m.role === 'prediction')
    .map((m) => {
      const id = m.id
      if (id === undefined || !PREDICTION_IDS.has(id)) {
        throw new Error(`unknown prediction model id "${String(id)}"`)
      }
      return { name: id, version: m.version }
    })

  return {
    embeddingModel: {
      name: embeddingId,
      version: embeddings[0]?.version ?? '',
    },
    predictionModels,
  } as PredictionSuiteConfig
}

/** Sync source for createApp/tests: the checked-in dev inventory file. */
export function resolveSuiteFromConfig(
  models: Config['models'],
): PredictionSuiteConfig {
  return buildSuiteFromInventory(
    loadModelInventoryFromFile(models.inventoryFile),
  )
}

/**
 * Boot source: OCI config blob when a digest is pinned (prod), else the dev
 * file. Fails loud — no stale/hardcoded fallback.
 */
export async function loadSuiteForBoot(
  models: Config['models'],
): Promise<PredictionSuiteConfig> {
  if (models.artifactRef) {
    const inventory = await fetchModelInventoryFromOci({
      ref: models.artifactRef,
      token: models.artifactToken || undefined,
    })
    return buildSuiteFromInventory(inventory)
  }
  return resolveSuiteFromConfig(models)
}
