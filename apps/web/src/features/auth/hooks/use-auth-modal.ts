import { useContext } from 'react'

import { AuthModalContext } from '#/features/auth/components/AuthModalProvider'
import type { AuthModalContextValue } from '#/features/auth/types'

export function useAuthModal(): AuthModalContextValue {
  const ctx = useContext(AuthModalContext)
  if (!ctx)
    throw new Error('useAuthModal must be used within AuthModalProvider')
  return ctx
}
