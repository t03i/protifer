import { MAX_SEQUENCE_LENGTH_CAP } from '@protifer/shared'
import { describe, it, expect } from 'vitest'

import {
  ErrorResponseSchema,
  JobIdParamSchema,
  JobAcceptedSchema,
} from './common.ts'
import { EmbeddingSubmitBodySchema } from './embeddings.ts'
import { FoldseekRequestSchema, isAllowedStructureUrl } from './foldseek.ts'
import { PredictionSubmitBodySchema } from './predictions.ts'

describe('PredictionSubmitBodySchema', () => {
  it('accepts a valid sequence', () => {
    expect(
      PredictionSubmitBodySchema.safeParse({ sequence: 'MKTVRQERLK' }).success,
    ).toBe(true)
  })
  it('rejects empty sequence', () => {
    expect(PredictionSubmitBodySchema.safeParse({ sequence: '' }).success).toBe(
      false,
    )
  })
  it('rejects missing sequence', () => {
    expect(PredictionSubmitBodySchema.safeParse({}).success).toBe(false)
  })
  it('accepts a sequence at the max length', () => {
    expect(
      PredictionSubmitBodySchema.safeParse({
        sequence: 'A'.repeat(MAX_SEQUENCE_LENGTH_CAP),
      }).success,
    ).toBe(true)
  })
  it('rejects a sequence longer than the max length', () => {
    expect(
      PredictionSubmitBodySchema.safeParse({
        sequence: 'A'.repeat(MAX_SEQUENCE_LENGTH_CAP + 1),
      }).success,
    ).toBe(false)
  })
})

describe('EmbeddingSubmitBodySchema', () => {
  it('accepts a valid sequence', () => {
    expect(
      EmbeddingSubmitBodySchema.safeParse({ sequence: 'ACDE' }).success,
    ).toBe(true)
  })
  it('rejects empty sequence', () => {
    expect(EmbeddingSubmitBodySchema.safeParse({ sequence: '' }).success).toBe(
      false,
    )
  })
  it('accepts a sequence at the max length', () => {
    expect(
      EmbeddingSubmitBodySchema.safeParse({
        sequence: 'A'.repeat(MAX_SEQUENCE_LENGTH_CAP),
      }).success,
    ).toBe(true)
  })
  it('rejects a sequence longer than the max length', () => {
    expect(
      EmbeddingSubmitBodySchema.safeParse({
        sequence: 'A'.repeat(MAX_SEQUENCE_LENGTH_CAP + 1),
      }).success,
    ).toBe(false)
  })
})

describe('JobIdParamSchema', () => {
  it('accepts a valid jobId', () => {
    expect(JobIdParamSchema.safeParse({ jobId: 'pred_abc123' }).success).toBe(
      true,
    )
  })
  it('rejects missing jobId', () => {
    expect(JobIdParamSchema.safeParse({}).success).toBe(false)
  })
})

describe('JobAcceptedSchema', () => {
  it('accepts valid shape', () => {
    expect(
      JobAcceptedSchema.safeParse({
        jobId: 'j1',
        statusUrl: '/v1/predictions/j1',
      }).success,
    ).toBe(true)
  })
})

describe('ErrorResponseSchema', () => {
  it('accepts error with optional code', () => {
    expect(
      ErrorResponseSchema.safeParse({
        error: 'Bad request',
        code: 'VALIDATION_ERROR',
      }).success,
    ).toBe(true)
    expect(
      ErrorResponseSchema.safeParse({ error: 'Bad request' }).success,
    ).toBe(true)
  })
})

describe('isAllowedStructureUrl', () => {
  it('accepts the known structure hosts and their subdomains', () => {
    for (const url of [
      'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.cif',
      'https://files.rcsb.org/download/1ABC.pdb',
      'https://models.rcsb.org/x.cif',
      'https://swissmodel.expasy.org/x.pdb',
      'https://www.ebi.ac.uk/x',
      'https://ftp.ebi.ac.uk/x',
      'https://cdn.files.rcsb.org/download/1ABC.pdb',
    ]) {
      expect(isAllowedStructureUrl(url)).toBe(true)
    }
  })

  it('rejects http, internal addresses and look-alike hosts', () => {
    for (const url of [
      'http://alphafold.ebi.ac.uk/x', // not https
      'http://127.0.0.1/x',
      'http://169.254.169.254/latest/meta-data/',
      'https://localhost/x',
      'https://evil.com/alphafold.ebi.ac.uk',
      'https://alphafold.ebi.ac.uk.evil.com/x',
      'not-a-url',
    ]) {
      expect(isAllowedStructureUrl(url)).toBe(false)
    }
  })
})

describe('FoldseekRequestSchema databases', () => {
  const url = 'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.cif'

  it('applies the default when databases is omitted', () => {
    const parsed = FoldseekRequestSchema.safeParse({ model_url: url })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.databases).toEqual([
        'pdb100',
        'afdb50',
        'afdb-swissprot',
      ])
    }
  })

  it('rejects more than 8 databases', () => {
    const databases = Array.from({ length: 9 }, (_, i) => `db${String(i)}`)
    expect(
      FoldseekRequestSchema.safeParse({ model_url: url, databases }).success,
    ).toBe(false)
  })

  it('rejects database names with disallowed characters', () => {
    expect(
      FoldseekRequestSchema.safeParse({
        model_url: url,
        databases: ['pdb100', 'evil; drop'],
      }).success,
    ).toBe(false)
  })

  it('rejects database names longer than 64 chars', () => {
    expect(
      FoldseekRequestSchema.safeParse({
        model_url: url,
        databases: ['a'.repeat(65)],
      }).success,
    ).toBe(false)
  })

  it('rejects an empty databases array', () => {
    expect(
      FoldseekRequestSchema.safeParse({ model_url: url, databases: [] })
        .success,
    ).toBe(false)
  })
})
