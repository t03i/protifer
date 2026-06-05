// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UniProtEnrichment } from './UniProtEnrichment'

const mockUseMatch = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useMatch: (opts: unknown) => mockUseMatch(opts),
}))

vi.mock('#/features/structure/components/StructurePanel', () => ({
  StructurePanel: ({ accession }: { accession: string }) => (
    <div data-testid="structure-stub" data-accession={accession} />
  ),
}))

vi.mock('#/features/uniref/components/UniRefClusters', () => ({
  UniRefClusters: ({ accession }: { accession: string }) => (
    <div data-testid="uniref-stub" data-accession={accession} />
  ),
}))

beforeEach(() => {
  mockUseMatch.mockReset()
})

describe('UniProtEnrichment provenance banner', () => {
  it('shows banner on /results/raw (user-submitted sequence with accession)', () => {
    mockUseMatch.mockReturnValue({ params: {} })
    render(<UniProtEnrichment accession="P04637" />)

    expect(
      screen.getByText(/Your submitted sequence may differ/i),
    ).toBeDefined()
    expect(screen.getByText('P04637')).toBeDefined()
  })

  it('hides banner on /results/uniprot/$accession route', () => {
    mockUseMatch.mockReturnValue(undefined)
    render(<UniProtEnrichment accession="P04637" />)

    expect(screen.queryByText(/Your submitted sequence may differ/i)).toBeNull()
    expect(screen.getByTestId('structure-stub')).toBeDefined()
    expect(screen.getByTestId('uniref-stub')).toBeDefined()
  })

  it('still renders structure and uniref panels alongside the banner', () => {
    mockUseMatch.mockReturnValue({ params: {} })
    render(<UniProtEnrichment accession="P04637" />)

    expect(screen.getByTestId('structure-stub')).toBeDefined()
    expect(screen.getByTestId('uniref-stub')).toBeDefined()
  })
})
