import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { AuthModal } from './AuthModal'

import { useAuthContext } from '#/features/auth/context'
import type {
  AuthModalContextValue,
  AuthModalState,
  OpenOptions,
} from '#/features/auth/types'

export const AuthModalContext = createContext<AuthModalContextValue | null>(
  null,
)

const DEFAULT_STATE: AuthModalState = {
  isOpen: false,
  dismissable: true,
  contextType: 'generic',
  redirectTo: '/',
}

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthModalState>(DEFAULT_STATE)
  const { isAuthenticated } = useAuthContext()

  const open = useCallback((options?: OpenOptions) => {
    setState({
      isOpen: true,
      dismissable: options?.dismissable ?? true,
      contextType: options?.contextType ?? 'generic',
      contextValue: options?.contextValue,
      redirectTo: options?.redirectTo ?? window.location.pathname,
    })
  }, [])

  const close = useCallback(() => {
    setState(DEFAULT_STATE)
  }, [])

  // Toggle blur + inert on page content
  useEffect(() => {
    const el = document.getElementById('app-content')
    if (!el) return
    if (state.isOpen) {
      el.inert = true
      el.classList.add('blur-sm', 'pointer-events-none', 'select-none')
    } else {
      el.inert = false
      el.classList.remove('blur-sm', 'pointer-events-none', 'select-none')
    }
    return () => {
      el.inert = false
      el.classList.remove('blur-sm', 'pointer-events-none', 'select-none')
    }
  }, [state.isOpen])

  // Auto-close when user becomes authenticated
  useEffect(() => {
    if (isAuthenticated && state.isOpen) {
      close()
    }
  }, [isAuthenticated, state.isOpen, close])

  const value = useMemo<AuthModalContextValue>(
    () => ({ open, close, state }),
    [open, close, state],
  )

  return (
    <AuthModalContext.Provider value={value}>
      {children}
      <AuthModal />
    </AuthModalContext.Provider>
  )
}
