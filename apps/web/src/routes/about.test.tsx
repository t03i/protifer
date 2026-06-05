// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, FunctionComponent, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    ({ component }: { component: FunctionComponent }) => ({ component }),
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string
    children: ReactNode
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

const { Route } = await import('./about')

const AboutPage = (Route as unknown as { component: FunctionComponent })
  .component

describe('/about', () => {
  it('renders the heading and institutional affiliation', () => {
    render(<AboutPage />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'About' }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByText(/Technical University of Munich/i).length,
    ).toBeGreaterThan(0)
  })

  it('exposes a GitHub link and a canonical DOI', () => {
    render(<AboutPage />)
    const gh = screen.getByRole('link', { name: /github.com\/t03i\/protifer/i })
    expect(gh).toHaveAttribute('href', 'https://github.com/t03i/protifer')
    const doi = screen.getByRole('link', { name: /doi:10\.1002\/pro\.4524/i })
    expect(doi).toHaveAttribute('href', 'https://doi.org/10.1002/pro.4524')
  })
})
