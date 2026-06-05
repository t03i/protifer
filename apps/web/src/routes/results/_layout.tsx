import { Outlet, createFileRoute, useMatch } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'

import { useAuthContext } from '#/features/auth/context'
import { useAuthModal } from '#/features/auth/hooks/use-auth-modal'
import { isDemoAccession, isDemoSequence } from '#/lib/demo'

export const Route = createFileRoute('/results/_layout')({
  component: ResultsLayout,
})

export function ResultsLayout() {
  const { isAuthenticated, isLoading } = useAuthContext()
  const { open, close, state } = useAuthModal()

  const accessionMatch = useMatch({
    from: '/results/_layout/uniprot/$accession',
    shouldThrow: false,
  })

  const rawMatch = useMatch({
    from: '/results/_layout/raw',
    shouldThrow: false,
  })

  const rawSequence = rawMatch
    ? new URLSearchParams(window.location.search).get('sequence')
    : null

  const isDemoRoute =
    (accessionMatch != null &&
      isDemoAccession(accessionMatch.params.accession)) ||
    (rawSequence != null && isDemoSequence(rawSequence))

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isDemoRoute && !state.isOpen) {
      open({
        dismissable: false,
        contextType: accessionMatch ? 'accession' : 'sequence',
        contextValue: accessionMatch?.params.accession,
        redirectTo: window.location.pathname + window.location.search,
      })
    }
  }, [
    isLoading,
    isAuthenticated,
    isDemoRoute,
    state.isOpen,
    open,
    accessionMatch,
  ])

  // Close modal when leaving the results layout
  useEffect(() => {
    return () => close()
  }, [close])

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading</span>
      </div>
    )
  }

  return <Outlet />
}
