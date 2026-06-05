// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import type { FunctionComponent } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    ({ component }: { component: FunctionComponent }) => ({ component }),
}))

const { Route } = await import('./methods')
const { methods } = await import('#/content/methods')

const MethodsPage = (Route as unknown as { component: FunctionComponent })
  .component

describe('/methods', () => {
  it('renders the page heading', () => {
    render(<MethodsPage />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Methods' }),
    ).toBeInTheDocument()
  })

  it('renders a card per method with a DOI link', () => {
    render(<MethodsPage />)
    for (const m of methods) {
      const doiLink = screen.getByRole('link', {
        name: new RegExp(`doi:${m.doi.replace(/[./]/g, '\\$&')}`),
      })
      expect(doiLink).toHaveAttribute('href', `https://doi.org/${m.doi}`)
      expect(doiLink).toHaveAttribute('target', '_blank')
      expect(doiLink).toHaveAttribute('rel', 'noopener noreferrer')
    }
  })

  it('exposes slug anchors for every method', () => {
    const { container } = render(<MethodsPage />)
    for (const m of methods) {
      expect(container.querySelector(`#${m.slug}`)).not.toBeNull()
    }
  })
})
