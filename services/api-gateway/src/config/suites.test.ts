import type { ModelInventory } from '@protifer/shared'
import { describe, expect, it } from 'vitest'

import { ConfigSchema, TEST_ENV } from './schema.ts'
import { buildSuiteFromInventory, resolveSuiteFromConfig } from './suites.ts'

const INVENTORY: ModelInventory = {
  models: [
    {
      triton: 'prot_t5_pipeline',
      id: 'prott5_xl_u50',
      role: 'embedding',
      version: 'e1',
    },
    {
      triton: 'prott5_sec',
      id: 'prott5_secondary_structure',
      role: 'prediction',
      version: 'p1',
    },
    { triton: 'tmbed', id: 'tmbed', role: 'prediction', version: 'p2' },
    { triton: '_tmbed_viterbi', role: 'internal', version: 'i1' },
  ],
}

describe('buildSuiteFromInventory', () => {
  it('builds the suite from inventory ids and per-model versions', () => {
    const suite = buildSuiteFromInventory(INVENTORY)
    expect(suite.embeddingModel).toEqual({
      name: 'prott5_xl_u50',
      version: 'e1',
    })
    expect(suite.predictionModels).toEqual([
      { name: 'prott5_secondary_structure', version: 'p1' },
      { name: 'tmbed', version: 'p2' },
    ])
  })

  it('excludes internal entries from the suite', () => {
    const suite = buildSuiteFromInventory(INVENTORY)
    expect(suite.predictionModels.some((m) => m.name.startsWith('_'))).toBe(
      false,
    )
  })

  it('reads each model version independently (per-model, not shared)', () => {
    const suite = buildSuiteFromInventory(INVENTORY)
    const versions = suite.predictionModels.map((m) => m.version)
    expect(new Set(versions).size).toBe(versions.length)
  })

  it('fails fast on an unknown prediction id', () => {
    expect(() =>
      buildSuiteFromInventory({
        models: [
          {
            triton: 'prot_t5_pipeline',
            id: 'prott5_xl_u50',
            role: 'embedding',
            version: 'e',
          },
          {
            triton: 'mystery',
            id: 'not_a_real_model',
            role: 'prediction',
            version: 'p',
          },
        ],
      }),
    ).toThrow(/unknown prediction model id/)
  })

  it('fails fast on an unknown embedding id', () => {
    expect(() =>
      buildSuiteFromInventory({
        models: [
          {
            triton: 'x',
            id: 'not_an_embedding',
            role: 'embedding',
            version: 'e',
          },
        ],
      }),
    ).toThrow(/unknown embedding model id/)
  })

  it('requires exactly one embedding model', () => {
    expect(() =>
      buildSuiteFromInventory({
        models: [
          { triton: 'tmbed', id: 'tmbed', role: 'prediction', version: 'p' },
        ],
      }),
    ).toThrow(/exactly one embedding model/)
  })
})

describe('resolveSuiteFromConfig (dev file source)', () => {
  const cfg = ConfigSchema.load(TEST_ENV)

  it('loads the checked-in dev inventory', () => {
    const suite = resolveSuiteFromConfig(cfg.models)
    expect(suite.embeddingModel.name).toBe('prott5_xl_u50')
    expect(suite.predictionModels.length).toBe(7)
  })
})
