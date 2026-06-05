// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthModalProvider } from './AuthModalProvider'

import { useAuthModal } from '#/features/auth/hooks/use-auth-modal'

vi.mock('#/features/auth/context', () => ({
  useAuthContext: vi.fn(),
}))

const { useAuthContext } = await import('#/features/auth/context')

const mockAuth = (
  overrides: Partial<{
    isAuthenticated: boolean
    isLoading: boolean
    user: { id: string; name: string; email: string } | null
    login: () => void
    logout: () => void
  }> = {},
) => ({
  isAuthenticated: false,
  isLoading: false,
  user: null,
  login: vi.fn(),
  logout: vi.fn(),
  ...overrides,
})

function TestConsumer() {
  const { open, close, state } = useAuthModal()
  return (
    <div>
      <span data-testid="is-open">{String(state.isOpen)}</span>
      <button onClick={() => open()}>open-generic</button>
      <button
        onClick={() =>
          open({
            contextType: 'accession',
            contextValue: 'P04637',
            dismissable: false,
          })
        }
      >
        open-accession
      </button>
      <button onClick={() => open({ contextType: 'sequence' })}>
        open-sequence
      </button>
      <button onClick={() => close()}>close-modal</button>
    </div>
  )
}

describe('AuthModalProvider', () => {
  let appContentEl: HTMLDivElement

  beforeEach(() => {
    vi.mocked(useAuthContext).mockReturnValue(mockAuth())
    appContentEl = document.createElement('div')
    appContentEl.id = 'app-content'
    document.body.appendChild(appContentEl)
  })

  afterEach(() => {
    document.getElementById('app-content')?.remove()
    vi.restoreAllMocks()
  })

  it('throws when useAuthModal is used outside AuthModalProvider', () => {
    function Broken() {
      useAuthModal()
      return null
    }
    // Suppress React error boundary console noise
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Broken />)).toThrow(
      'useAuthModal must be used within AuthModalProvider',
    )
  })

  it('open() sets isOpen to true and renders the modal dialog', async () => {
    render(
      <AuthModalProvider>
        <TestConsumer />
      </AuthModalProvider>,
    )

    expect(screen.getByTestId('is-open')).toHaveTextContent('false')

    await userEvent.click(screen.getByText('open-generic'))

    expect(screen.getByTestId('is-open')).toHaveTextContent('true')
    expect(screen.getByText('Sign in to continue')).toBeInTheDocument()
  })

  it('close() sets isOpen to false and hides the modal dialog', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(
      <AuthModalProvider>
        <TestConsumer />
      </AuthModalProvider>,
    )

    await user.click(screen.getByText('open-generic'))
    expect(screen.getByText('Sign in to continue')).toBeInTheDocument()

    await user.click(screen.getByText('close-modal'))
    expect(screen.getByTestId('is-open')).toHaveTextContent('false')
  })

  it('open() applies blur-sm class and inert attribute to #app-content', async () => {
    render(
      <AuthModalProvider>
        <TestConsumer />
      </AuthModalProvider>,
    )

    await userEvent.click(screen.getByText('open-generic'))

    expect(appContentEl.classList.contains('blur-sm')).toBe(true)
    expect(appContentEl.inert).toBe(true)
  })

  it('close() removes blur-sm class and inert attribute from #app-content', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(
      <AuthModalProvider>
        <TestConsumer />
      </AuthModalProvider>,
    )

    await user.click(screen.getByText('open-generic'))
    expect(appContentEl.classList.contains('blur-sm')).toBe(true)
    expect(appContentEl.inert).toBe(true)

    await user.click(screen.getByText('close-modal'))
    expect(appContentEl.classList.contains('blur-sm')).toBe(false)
    expect(appContentEl.inert).toBe(false)
  })

  it('auto-closes modal when isAuthenticated becomes true', async () => {
    const { rerender } = render(
      <AuthModalProvider>
        <TestConsumer />
      </AuthModalProvider>,
    )

    await userEvent.click(screen.getByText('open-generic'))
    expect(screen.getByTestId('is-open')).toHaveTextContent('true')

    vi.mocked(useAuthContext).mockReturnValue(
      mockAuth({ isAuthenticated: true }),
    )

    rerender(
      <AuthModalProvider>
        <TestConsumer />
      </AuthModalProvider>,
    )

    expect(screen.getByTestId('is-open')).toHaveTextContent('false')
  })
})
