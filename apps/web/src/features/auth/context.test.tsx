// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AuthProvider, useAuthContext } from './context'

vi.mock('#/services/auth/client', () => ({
  authClient: {
    useSession: vi.fn(),
    signIn: { social: vi.fn() },
    signOut: vi.fn(),
  },
}))

const { authClient } = await import('#/services/auth/client')

describe('useAuthContext', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('reflects loading state while session is pending', () => {
    vi.mocked(authClient.useSession).mockReturnValue({
      data: null,
      isPending: true,
      error: null,
    } as ReturnType<typeof authClient.useSession>)

    const { result } = renderHook(() => useAuthContext(), {
      wrapper: AuthProvider,
    })

    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.isLoading).toBe(true)
    expect(result.current.user).toBeNull()
  })

  it('returns isAuthenticated: true and user data when session exists', () => {
    vi.mocked(authClient.useSession).mockReturnValue({
      data: { user: { id: '1', name: 'Alice', email: 'a@b.com' } },
      isPending: false,
      error: null,
    } as ReturnType<typeof authClient.useSession>)

    const { result } = renderHook(() => useAuthContext(), {
      wrapper: AuthProvider,
    })

    expect(result.current.isAuthenticated).toBe(true)
    expect(result.current.user).toEqual({
      id: '1',
      name: 'Alice',
      email: 'a@b.com',
    })
  })

  it('login calls authClient.signIn.social with provider github', () => {
    vi.stubEnv('VITE_APP_URL', '')
    vi.mocked(authClient.useSession).mockReturnValue({
      data: null,
      isPending: false,
      error: null,
    } as ReturnType<typeof authClient.useSession>)

    const { result } = renderHook(() => useAuthContext(), {
      wrapper: AuthProvider,
    })

    result.current.login('/history')
    expect(authClient.signIn.social).toHaveBeenCalledWith({
      provider: 'github',
      callbackURL: '/history',
    })
  })

  it('login prepends VITE_APP_URL to callbackURL', () => {
    vi.stubEnv('VITE_APP_URL', 'https://app.example.com')
    vi.mocked(authClient.useSession).mockReturnValue({
      data: null,
      isPending: false,
      error: null,
    } as ReturnType<typeof authClient.useSession>)

    const { result } = renderHook(() => useAuthContext(), {
      wrapper: AuthProvider,
    })

    result.current.login('/dashboard')
    expect(authClient.signIn.social).toHaveBeenCalledWith({
      provider: 'github',
      callbackURL: 'https://app.example.com/dashboard',
    })
  })

  it('login defaults to / when redirectTo is unsafe', () => {
    vi.stubEnv('VITE_APP_URL', '')
    vi.mocked(authClient.useSession).mockReturnValue({
      data: null,
      isPending: false,
      error: null,
    } as ReturnType<typeof authClient.useSession>)

    const { result } = renderHook(() => useAuthContext(), {
      wrapper: AuthProvider,
    })

    result.current.login('//evil.com/phish')
    expect(authClient.signIn.social).toHaveBeenCalledWith({
      provider: 'github',
      callbackURL: '/',
    })
  })

  it('logout calls authClient.signOut', () => {
    vi.mocked(authClient.useSession).mockReturnValue({
      data: null,
      isPending: false,
      error: null,
    } as ReturnType<typeof authClient.useSession>)

    const { result } = renderHook(() => useAuthContext(), {
      wrapper: AuthProvider,
    })

    result.current.logout()
    expect(authClient.signOut).toHaveBeenCalled()
  })
})
