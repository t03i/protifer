import { useRouterState } from '@tanstack/react-router'

import { cn } from '#/lib/utils'

/**
 * Thin top-of-viewport bar that animates while the router resolves a
 * navigation (e.g. the UniProt loader on `/results/uniprot/$accession`).
 * Gives instant feedback for the sub-second window before a route's
 * pendingComponent skeleton kicks in.
 */
export function NavigationProgress() {
  const isLoading = useRouterState({ select: (s) => s.status === 'pending' })

  return (
    <div
      role="progressbar"
      aria-label="Loading"
      aria-busy={isLoading}
      aria-hidden={!isLoading}
      className={cn(
        'pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden transition-opacity duration-200',
        isLoading ? 'opacity-100' : 'opacity-0',
      )}
    >
      {isLoading && (
        <div className="h-full w-full origin-left animate-progress-indeterminate bg-primary" />
      )}
    </div>
  )
}
