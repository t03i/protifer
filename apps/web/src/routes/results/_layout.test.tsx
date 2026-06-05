// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#/features/auth/context', () => ({
  useAuthContext: vi.fn(),
}))

vi.mock('#/features/auth/hooks/use-auth-modal', () => ({
  useAuthModal: vi.fn(),
}))

vi.mock('#/lib/demo', () => ({
  isDemoAccession: vi.fn((accession: string) =>
    ['P04637', 'P38398', 'P12345'].includes(accession),
  ),
  isDemoSequence: vi.fn(
    (seq: string) =>
      seq === 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKLVV',
  ),
}))

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => <div data-testid="outlet">Child Content</div>,
  createFileRoute:
    () =>
    ({ component }: { component: unknown }) => ({
      component,
    }),
  useMatch: vi.fn(),
}))

const { useAuthContext } = await import('#/features/auth/context')
const { useAuthModal } = await import('#/features/auth/hooks/use-auth-modal')
const { useMatch } = await import('@tanstack/react-router')
const { ResultsLayout } = await import('./_layout')

Object.defineProperty(window, 'location', {
  value: { pathname: '/results/raw', search: '?sequence=ACGT' },
  writable: true,
})

const mockOpen = vi.fn()
const mockClose = vi.fn()

function mockUseMatch(
  opts: {
    accession?: { params: { accession: string } }
    raw?: Record<string, unknown>
  } = {},
) {
  vi.mocked(useMatch).mockImplementation(((args: { from: string }) => {
    if (args.from.includes('uniprot')) return opts.accession
    if (args.from.includes('raw')) return opts.raw
    return undefined
  }) as typeof useMatch)
}

const defaultModalState = {
  isOpen: false,
  dismissable: true,
  contextType: 'generic' as const,
  redirectTo: '/',
}

function mockAuthContext(
  overrides: Partial<{
    isAuthenticated: boolean
    isLoading: boolean
    user: { id: string; name: string; email: string } | null
    login: () => void
    logout: () => void
  }> = {},
) {
  vi.mocked(useAuthContext).mockReturnValue({
    isAuthenticated: false,
    isLoading: false,
    user: null,
    login: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  })
}

function mockAuthModal(stateOverrides: Partial<typeof defaultModalState> = {}) {
  vi.mocked(useAuthModal).mockReturnValue({
    open: mockOpen,
    close: mockClose,
    state: { ...defaultModalState, ...stateOverrides },
  })
}

describe('ResultsLayout', () => {
  beforeEach(() => {
    mockOpen.mockClear()
    mockClose.mockClear()
    mockUseMatch()
    mockAuthModal()
    mockAuthContext()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows loading spinner when auth is pending', () => {
    mockAuthContext({ isLoading: true, isAuthenticated: false })

    render(<ResultsLayout />)

    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(screen.queryByTestId('outlet')).toBeNull()
    expect(mockOpen).not.toHaveBeenCalled()
  })

  it('renders outlet when authenticated', () => {
    mockAuthContext({ isLoading: false, isAuthenticated: true })

    render(<ResultsLayout />)

    expect(screen.getByTestId('outlet')).toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toHaveTextContent('Child Content')
    expect(screen.queryByText('Loading')).toBeNull()
    expect(mockOpen).not.toHaveBeenCalled()
  })

  it('opens non-dismissable modal when unauthenticated', () => {
    mockAuthContext({ isLoading: false, isAuthenticated: false })

    render(<ResultsLayout />)

    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ dismissable: false }),
    )
  })

  it('renders outlet behind modal when unauthenticated', () => {
    mockAuthContext({ isLoading: false, isAuthenticated: false })

    render(<ResultsLayout />)

    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('passes pathname + search as redirectTo', () => {
    mockAuthContext({ isLoading: false, isAuthenticated: false })

    render(<ResultsLayout />)

    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ redirectTo: '/results/raw?sequence=ACGT' }),
    )
  })

  it('passes contextType accession with accession value when on accession route', () => {
    mockUseMatch({ accession: { params: { accession: 'Q99999' } } })
    mockAuthContext({ isLoading: false, isAuthenticated: false })

    render(<ResultsLayout />)

    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        contextType: 'accession',
        contextValue: 'Q99999',
      }),
    )
  })

  it('passes contextType sequence when on raw route', () => {
    mockUseMatch()
    mockAuthContext({ isLoading: false, isAuthenticated: false })

    render(<ResultsLayout />)

    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ contextType: 'sequence' }),
    )
  })

  it('does not call open when modal is already open', () => {
    mockAuthModal({ isOpen: true })
    mockAuthContext({ isLoading: false, isAuthenticated: false })

    render(<ResultsLayout />)

    expect(mockOpen).not.toHaveBeenCalled()
  })

  it('closes modal when layout unmounts (navigation away)', () => {
    mockAuthContext({ isLoading: false, isAuthenticated: false })
    mockAuthModal({ isOpen: true })

    const { unmount } = render(<ResultsLayout />)
    unmount()

    expect(mockClose).toHaveBeenCalled()
  })

  it('does not redirect when unauthenticated', () => {
    // Router mock has no redirect/navigate, so no navigation side-effects occur.
    mockAuthContext({ isLoading: false, isAuthenticated: false })

    expect(() => render(<ResultsLayout />)).not.toThrow()
  })
})

describe('submit interception (SUBMIT-01, SUBMIT-02, SUBMIT-03)', () => {
  beforeEach(() => {
    mockOpen.mockClear()
    mockClose.mockClear()
    mockUseMatch()
    mockAuthModal()
    mockAuthContext()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('SUBMIT-01: unauthenticated sequence submission is intercepted at route level (no API call)', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/results/raw', search: '?sequence=MKTAYIAK' },
      writable: true,
    })
    mockAuthContext({ isLoading: false, isAuthenticated: false })
    mockAuthModal()
    mockUseMatch()

    render(<ResultsLayout />)

    // Modal opens = interception happened (no API call made, no redirect)
    expect(mockOpen).toHaveBeenCalled()
    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ dismissable: false }),
    )
    // Outlet still renders = content visible behind modal (blur overlay, not redirect)
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('SUBMIT-02: intercepted submission shows unified auth modal with sequence context', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/results/raw', search: '?sequence=MKTAYIAK' },
      writable: true,
    })
    mockAuthContext({ isLoading: false, isAuthenticated: false })
    mockAuthModal()
    mockUseMatch()

    render(<ResultsLayout />)

    // The unified modal (not a redirect or inline form) is shown with sequence context
    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ contextType: 'sequence' }),
    )
  })

  it('SUBMIT-03: redirectTo preserves full results URL for post-OAuth navigation', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/results/raw', search: '?sequence=MKTAYIAKQRQISFVK' },
      writable: true,
    })
    mockAuthContext({ isLoading: false, isAuthenticated: false })
    mockAuthModal()
    mockUseMatch()

    render(<ResultsLayout />)

    // After OAuth return, callbackURL restores prediction results page with sequence param
    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectTo: '/results/raw?sequence=MKTAYIAKQRQISFVK',
      }),
    )
  })
})

describe('demo accession bypass (DEMO-01)', () => {
  beforeEach(() => {
    mockOpen.mockClear()
    mockClose.mockClear()
    mockUseMatch()
    mockAuthModal()
    mockAuthContext()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not open modal for demo accession P04637 when unauthenticated', () => {
    mockUseMatch({ accession: { params: { accession: 'P04637' } } })
    mockAuthContext({ isLoading: false, isAuthenticated: false })

    render(<ResultsLayout />)

    expect(mockOpen).not.toHaveBeenCalled()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('does not open modal for demo accession P38398 when unauthenticated', () => {
    mockUseMatch({ accession: { params: { accession: 'P38398' } } })
    mockAuthContext({ isLoading: false, isAuthenticated: false })

    render(<ResultsLayout />)

    expect(mockOpen).not.toHaveBeenCalled()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('still opens modal for non-demo accession Q99999 when unauthenticated', () => {
    mockUseMatch({ accession: { params: { accession: 'Q99999' } } })
    mockAuthContext({ isLoading: false, isAuthenticated: false })

    render(<ResultsLayout />)

    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ dismissable: false }),
    )
  })

  it('still opens modal for raw sequence route when unauthenticated', () => {
    mockUseMatch()
    mockAuthContext({ isLoading: false, isAuthenticated: false })

    render(<ResultsLayout />)

    expect(mockOpen).toHaveBeenCalled()
  })

  it('renders outlet for demo accession (content visible, no blur)', () => {
    mockUseMatch({ accession: { params: { accession: 'P04637' } } })
    mockAuthContext({ isLoading: false, isAuthenticated: false })

    render(<ResultsLayout />)

    expect(screen.getByTestId('outlet')).toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toHaveTextContent('Child Content')
  })
})
