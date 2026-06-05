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
    login: (redirectTo?: string) => void
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
  const { open } = useAuthModal()
  return (
    <div>
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
      <button onClick={() => open({ dismissable: false })}>
        open-nondismissable
      </button>
      <button onClick={() => open({ dismissable: true })}>
        open-dismissable
      </button>
      <button
        onClick={() =>
          open({ redirectTo: '/predictions/P04637', dismissable: true })
        }
      >
        open-with-redirect
      </button>
    </div>
  )
}

describe('AuthModal', () => {
  beforeEach(() => {
    vi.mocked(useAuthContext).mockReturnValue(mockAuth())
    const el = document.createElement('div')
    el.id = 'app-content'
    document.body.appendChild(el)
  })

  afterEach(() => {
    document.getElementById('app-content')?.remove()
    vi.restoreAllMocks()
  })

  it('renders "Sign in to continue" title when open', async () => {
    render(
      <AuthModalProvider>
        <TestConsumer />
      </AuthModalProvider>,
    )

    await userEvent.click(screen.getByText('open-generic'))
    expect(screen.getByText('Sign in to continue')).toBeInTheDocument()
  })

  it('renders "Sign in with GitHub" button when open', async () => {
    render(
      <AuthModalProvider>
        <TestConsumer />
      </AuthModalProvider>,
    )

    await userEvent.click(screen.getByText('open-generic'))
    expect(
      screen.getByRole('button', { name: /sign in with github/i }),
    ).toBeInTheDocument()
  })

  it('non-dismissable mode: does not render close button', async () => {
    render(
      <AuthModalProvider>
        <TestConsumer />
      </AuthModalProvider>,
    )

    await userEvent.click(screen.getByText('open-nondismissable'))
    expect(
      screen.queryByRole('button', { name: /close/i }),
    ).not.toBeInTheDocument()
  })

  it('dismissable mode: renders close button', async () => {
    render(
      <AuthModalProvider>
        <TestConsumer />
      </AuthModalProvider>,
    )

    await userEvent.click(screen.getByText('open-dismissable'))
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('contextType accession with contextValue P04637 renders correct description', async () => {
    render(
      <AuthModalProvider>
        <TestConsumer />
      </AuthModalProvider>,
    )

    await userEvent.click(screen.getByText('open-accession'))
    expect(
      screen.getByText('Sign in to view predictions for P04637'),
    ).toBeInTheDocument()
  })

  it('contextType sequence renders "Sign in to view predictions for your sequence"', async () => {
    render(
      <AuthModalProvider>
        <TestConsumer />
      </AuthModalProvider>,
    )

    await userEvent.click(screen.getByText('open-sequence'))
    expect(
      screen.getByText('Sign in to view predictions for your sequence'),
    ).toBeInTheDocument()
  })

  it('contextType generic renders "Sign in to access this page"', async () => {
    render(
      <AuthModalProvider>
        <TestConsumer />
      </AuthModalProvider>,
    )

    await userEvent.click(screen.getByText('open-generic'))
    expect(screen.getByText('Sign in to access this page')).toBeInTheDocument()
  })

  it('clicking sign-in button calls login with correct redirectTo path', async () => {
    const mockLogin = vi.fn()
    vi.mocked(useAuthContext).mockReturnValue(mockAuth({ login: mockLogin }))

    render(
      <AuthModalProvider>
        <TestConsumer />
      </AuthModalProvider>,
    )

    await userEvent.click(screen.getByText('open-with-redirect'))
    await userEvent.click(
      screen.getByRole('button', { name: /sign in with github/i }),
    )
    expect(mockLogin).toHaveBeenCalledWith('/predictions/P04637')
  })
})
