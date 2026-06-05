import { describe, expect, it } from 'vitest'

import { ConfigSchema, TEST_ENV } from './schema.ts'
import { buildSuiteV1 } from './suites.ts'

describe('buildSuiteV1', () => {
  const cfg = ConfigSchema.load(TEST_ENV)

  it('uses the model version from config', () => {
    const suite = buildSuiteV1(cfg.models)
    expect(suite.embeddingModel.name).toBe('prott5_xl_u50')
    expect(suite.embeddingModel.version).toBe(cfg.models.version)
  })

  it('emits one entry per registered prediction model', () => {
    const suite = buildSuiteV1(cfg.models)
    expect(suite.predictionModels.length).toBe(7)
  })

  it('applies MODELS_VERSION to all suite models', () => {
    const overridden = ConfigSchema.load({
      ...TEST_ENV,
      MODELS_VERSION: 'v9',
    })
    const suite = buildSuiteV1(overridden.models)
    expect(suite.embeddingModel.version).toBe('v9')
    expect(suite.predictionModels.every((m) => m.version === 'v9')).toBe(true)
  })
})
