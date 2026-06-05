// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ServiceStatusBanner, ServiceStatusDot } from './ServiceStatus'

vi.mock('./useServiceStatus', () => ({
  useServiceStatus: vi.fn(),
}))

const { useServiceStatus } = await import('./useServiceStatus')

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('ServiceStatusDot', () => {
  it('renders a green dot when operational', () => {
    vi.mocked(useServiceStatus).mockReturnValue({ kind: 'operational' })
    render(<ServiceStatusDot />)
    const dot = screen.getByLabelText('Service status: operational')
    expect(dot).toBeInTheDocument()
    expect(dot.className).toContain('bg-green-500')
  })

  it('renders a pulsing red dot when connection-lost', () => {
    vi.mocked(useServiceStatus).mockReturnValue({ kind: 'connection-lost' })
    render(<ServiceStatusDot />)
    const dot = screen.getByLabelText('Service status: connection-lost')
    expect(dot.className).toContain('bg-red-500')
    expect(dot.className).toContain('animate-pulse')
  })
})

describe('ServiceStatusBanner', () => {
  it('renders nothing when operational', () => {
    vi.mocked(useServiceStatus).mockReturnValue({ kind: 'operational' })
    const { container } = render(<ServiceStatusBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('shows connection-lost banner text', () => {
    vi.mocked(useServiceStatus).mockReturnValue({ kind: 'connection-lost' })
    render(<ServiceStatusBanner />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/connection lost/i)).toBeInTheDocument()
  })

  it('shows degraded banner with link to status page when URL is set', () => {
    vi.stubEnv('VITE_STATUS_PAGE_URL', 'https://status.example.com')
    vi.mocked(useServiceStatus).mockReturnValue({ kind: 'degraded' })
    render(<ServiceStatusBanner />)
    expect(screen.getByText(/degraded/i)).toBeInTheDocument()
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://status.example.com')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('shows maintenance banner', () => {
    vi.mocked(useServiceStatus).mockReturnValue({ kind: 'maintenance' })
    render(<ServiceStatusBanner />)
    expect(screen.getByText(/maintenance/i)).toBeInTheDocument()
  })

  it('connection-lost banner does not link to status page even when URL is set', () => {
    vi.stubEnv('VITE_STATUS_PAGE_URL', 'https://status.example.com')
    vi.mocked(useServiceStatus).mockReturnValue({ kind: 'connection-lost' })
    render(<ServiceStatusBanner />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
