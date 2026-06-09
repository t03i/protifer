import type { ErrorEvent } from '@sentry/node'
import { describe, expect, it } from 'vitest'

import { AMINO_ACID_RUN, scrubAminoAcidRuns } from './sentry-scrub.ts'

const RUN = 'MKTAYIAKQRQISFVKSHFS' // 20-residue canonical run
const SHORT = 'MKTAYIAKQR' // 10 residues — below threshold

/** Build a minimal valid ErrorEvent (`type` is required on the union). */
function ev(partial: Partial<ErrorEvent>): ErrorEvent {
  return { type: undefined, ...partial }
}

describe('AMINO_ACID_RUN', () => {
  it('matches a >=20 canonical amino-acid run', () => {
    expect(AMINO_ACID_RUN.test(RUN)).toBe(true)
  })

  it('does not match a <20 run', () => {
    AMINO_ACID_RUN.lastIndex = 0
    expect(AMINO_ACID_RUN.test(SHORT)).toBe(false)
  })
})

describe('scrubAminoAcidRuns', () => {
  it('redacts a run embedded in the event message', () => {
    const out = scrubAminoAcidRuns(
      ev({
        message: `parse failed for ${RUN} at offset 3`,
      }),
    )
    expect(out.message).toBe('parse failed for [Filtered] at offset 3')
  })

  it('redacts runs in exception values', () => {
    const out = scrubAminoAcidRuns(
      ev({
        exception: { values: [{ type: 'Error', value: `bad seq ${RUN}` }] },
      }),
    )
    expect(out.exception?.values?.[0]?.value).toBe('bad seq [Filtered]')
  })

  it('redacts runs in breadcrumb message and data', () => {
    const out = scrubAminoAcidRuns(
      ev({
        breadcrumbs: [
          {
            message: `submit ${RUN}`,
            data: { fasta: RUN, nested: { seq: RUN } },
          },
        ],
      }),
    )
    const crumb = out.breadcrumbs?.[0]
    expect(crumb?.message).toBe('submit [Filtered]')
    expect((crumb?.data as Record<string, unknown>)['fasta']).toBe('[Filtered]')
    expect(
      (
        (crumb?.data as Record<string, unknown>)['nested'] as Record<
          string,
          unknown
        >
      )['seq'],
    ).toBe('[Filtered]')
  })

  it('redacts runs in request url, query_string, and data', () => {
    const out = scrubAminoAcidRuns(
      ev({
        request: {
          url: `https://x/predict/${RUN}`,
          query_string: `seq=${RUN}`,
          data: { sequence: RUN },
        },
      }),
    )
    expect(out.request?.url).toBe('https://x/predict/[Filtered]')
    expect(out.request?.query_string).toBe('seq=[Filtered]')
    expect((out.request?.data as Record<string, unknown>)['sequence']).toBe(
      '[Filtered]',
    )
  })

  it('redacts runs in extra and contexts', () => {
    const out = scrubAminoAcidRuns(
      ev({
        extra: { payload: RUN },
        contexts: { job: { input: RUN } },
      }),
    )
    expect((out.extra as Record<string, unknown>)['payload']).toBe('[Filtered]')
    expect((out.contexts?.['job'] as Record<string, unknown>)['input']).toBe(
      '[Filtered]',
    )
  })

  it('leaves short runs and unrelated text untouched', () => {
    const out = scrubAminoAcidRuns(
      ev({
        message: `ok ${SHORT} done`,
      }),
    )
    expect(out.message).toBe(`ok ${SHORT} done`)
  })

  it('redacts multiple runs in one string', () => {
    const out = scrubAminoAcidRuns(
      ev({
        message: `${RUN} and ${RUN}`,
      }),
    )
    expect(out.message).toBe('[Filtered] and [Filtered]')
  })

  it('returns the event when there is nothing to scrub', () => {
    const event = { message: 'plain error' } as ErrorEvent
    expect(scrubAminoAcidRuns(event)).toBe(event)
    expect(event.message).toBe('plain error')
  })

  it('tolerates deeply nested / cyclic data without throwing', () => {
    const data: Record<string, unknown> = { seq: RUN }
    data['self'] = data // cycle
    const out = scrubAminoAcidRuns(
      ev({
        breadcrumbs: [{ data }],
      }),
    )
    expect((out.breadcrumbs?.[0]?.data as Record<string, unknown>)['seq']).toBe(
      '[Filtered]',
    )
  })
})
