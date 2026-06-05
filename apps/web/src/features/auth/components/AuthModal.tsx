import { XIcon } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useContext, useState } from 'react'

import { AuthModalContext } from './AuthModalProvider'
import { LoginContent } from './LoginContent'

import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '#/components/ui/dialog'
import { useAuthContext } from '#/features/auth/context'
import type { AuthModalContextType } from '#/features/auth/types'

function getDescription(
  contextType: AuthModalContextType,
  contextValue?: string,
): string {
  switch (contextType) {
    case 'accession':
      return `Sign in to view predictions for ${contextValue}`
    case 'sequence':
      return 'Sign in to view predictions for your sequence'
    case 'generic':
      return 'Sign in to access this page'
  }
}

export function AuthModal() {
  const ctx = useContext(AuthModalContext)
  const { login } = useAuthContext()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!ctx) return null

  const { state, close } = ctx
  const description = getDescription(state.contextType, state.contextValue)

  const handleLogin = () => {
    setIsPending(true)
    setError(null)
    try {
      login(state.redirectTo)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      setIsPending(false)
    }
  }

  return (
    <Dialog
      open={state.isOpen}
      onOpenChange={(open) => {
        if (!open && !state.dismissable) return
        if (!open) close()
      }}
    >
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-sm" />
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className="fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg"
          onEscapeKeyDown={
            state.dismissable ? undefined : (e) => e.preventDefault()
          }
          onPointerDownOutside={
            state.dismissable ? undefined : (e) => e.preventDefault()
          }
          onInteractOutside={
            state.dismissable ? undefined : (e) => e.preventDefault()
          }
        >
          {state.dismissable && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
          <DialogHeader>
            <DialogTitle>Sign in to continue</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <LoginContent
            onLogin={handleLogin}
            isPending={isPending}
            error={error}
            showHeading={false}
          />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
