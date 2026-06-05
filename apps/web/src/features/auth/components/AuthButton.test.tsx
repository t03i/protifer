// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AuthButton } from './AuthButton'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string
    children: React.ReactNode
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

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

describe('AuthButton', () => {
  it('renders a skeleton while loading (no buttons)', () => {
    vi.mocked(useAuthContext).mockReturnValue(mockAuth({ isLoading: true }))
    render(<AuthButton />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders a sign-in button when not authenticated', () => {
    vi.mocked(useAuthContext).mockReturnValue(mockAuth())
    render(<AuthButton />)
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('calls login with current pathname on sign-in click', async () => {
    const mockLogin = vi.fn()
    vi.mocked(useAuthContext).mockReturnValue(mockAuth({ login: mockLogin }))
    render(<AuthButton />)
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))
    expect(mockLogin).toHaveBeenCalledWith(expect.any(String))
  })

  it('renders user initials and name when authenticated', () => {
    vi.mocked(useAuthContext).mockReturnValue(
      mockAuth({
        isAuthenticated: true,
        user: { id: '1', name: 'Alice Bob', email: 'a@b.com' },
      }),
    )
    render(<AuthButton />)
    expect(screen.getByText('AB')).toBeInTheDocument()
    expect(screen.getByText('Alice Bob')).toBeInTheDocument()
  })

  it('calls logout when sign-out menu item is clicked', async () => {
    const mockLogout = vi.fn()
    vi.mocked(useAuthContext).mockReturnValue(
      mockAuth({
        isAuthenticated: true,
        user: { id: '1', name: 'Alice Bob', email: 'a@b.com' },
        logout: mockLogout,
      }),
    )
    render(<AuthButton />)
    await userEvent.click(screen.getByRole('button'))
    await userEvent.click(screen.getByRole('menuitem', { name: /sign out/i }))
    expect(mockLogout).toHaveBeenCalled()
  })
})
