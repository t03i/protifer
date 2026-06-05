import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'

import { AppErrorBoundary } from '#/components/error/AppErrorBoundary'
import { RootLayout } from '#/components/layout/RootLayout'
import type { AuthContextValue } from '#/features/auth/context'

import '../styles.css'

interface RouterContext {
  queryClient: QueryClient
  auth: AuthContextValue
}

const DevtoolsPanel = import.meta.env.DEV
  ? lazy(() => import('#/integrations/tanstack-query/devtools'))
  : () => null

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
})

function RootComponent() {
  return (
    <>
      <AppErrorBoundary>
        <RootLayout />
      </AppErrorBoundary>
      <Suspense>
        <DevtoolsPanel />
      </Suspense>
    </>
  )
}
