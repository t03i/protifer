import type { PredictionSuiteConfig } from '@protifer/shared'

import type { Config } from './schema.ts'

export function buildSuiteV1(models: Config['models']): PredictionSuiteConfig {
  return {
    embeddingModel: {
      name: 'prott5_xl_u50',
      version: models.version,
    },
    predictionModels: [
      { name: 'prott5_secondary_structure', version: models.version },
      { name: 'tmbed', version: models.version },
      { name: 'seth', version: models.version },
      { name: 'bindembed', version: models.version },
      { name: 'prott5_conservation', version: models.version },
      { name: 'light_attention_subcellular', version: models.version },
      { name: 'light_attention_membrane', version: models.version },
    ],
  }
}
