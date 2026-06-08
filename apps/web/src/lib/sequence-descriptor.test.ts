import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { computeSequenceHash, describeSequence } from './sequence-descriptor'

/** The backend `computeSequenceHash` is exactly this (`packages/shared/src/hash.ts`). */
const backendHash = (s: string) => createHash('sha256').update(s).digest('hex')

const VECTORS = ['MKLV', 'ACDEFGHIKLMNPQRSTVWY', '', 'mNqÅ☃']

describe('computeSequenceHash parity with backend', () => {
  it.each(VECTORS)('matches backend hex for %j', async (seq) => {
    expect(await computeSequenceHash(seq)).toBe(backendHash(seq))
  })
})

describe('describeSequence', () => {
  it('returns hash and length, never the residues', async () => {
    const d = await describeSequence('MKLV')
    expect(d).toEqual({ sequenceHash: backendHash('MKLV'), seqLen: 4 })
  })
})
