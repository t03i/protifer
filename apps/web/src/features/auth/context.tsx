import * as Sentry from '@sentry/react'
import { createContext, useContext, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'

import { authClient } from '#/services/auth/client'

export interface AuthContextValue {
  isAuthenticated: boolean
  isLoading: boolean
  user: { id: string; name: string; email: string } | null
  login: (redirectTo?: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession()

  // Opaque better-auth `sub` only — mirrors the backend user-context middleware.
  useEffect(() => {
    const id = session?.user.id
    Sentry.setUser(id ? { id } : null)
  }, [session?.user.id])

  const value: AuthContextValue = useMemo(
    () => ({
      isAuthenticated: !!session,
      isLoading: isPending,
      user: session?.user ?? null,
      login: (redirectTo = '/') => {
        const safePath =
          redirectTo.startsWith('/') && !redirectTo.startsWith('//')
            ? redirectTo
            : '/'
        const appURL = import.meta.env['VITE_APP_URL'] || window.location.origin
        return authClient.signIn.social({
          provider: 'github',
          callbackURL: `${appURL}${safePath}`,
        })
      },
      logout: () => authClient.signOut(),
    }),
    [session, isPending],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider')
  return ctx
}
