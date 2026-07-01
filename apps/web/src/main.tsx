import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { ThemeProvider } from 'next-themes'
import ReactDOM from 'react-dom/client'

import { routeTree } from './routeTree.gen'

import { AuthModalProvider } from '#/features/auth/components/AuthModalProvider'
import type { AuthContextValue } from '#/features/auth/context'
import { AuthProvider, useAuthContext } from '#/features/auth/context'
import { FeatureFlagsMount } from '#/features/flags'
import { logger, makeSentryLogger, setLogger } from '#/lib/logger'
import { initFrontendSentry } from '#/lib/sentry'

initFrontendSentry()
if (import.meta.env['VITE_SENTRY_DSN']) setLogger(makeSentryLogger())

// Server-state failures (submit/poll 5xx, timeouts, network) surface to the UI
// as toasts but were otherwise invisible in prod — route them to the logger,
// which forwards to Sentry when a DSN is configured.
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) =>
      logger.error('query error', error, { queryKey: query.queryKey }),
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) =>
      logger.error('mutation error', error, {
        mutationKey: mutation.options.mutationKey,
      }),
  }),
})

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
  defaultPendingMs: 500,
  defaultPendingMinMs: 500,
  context: {
    queryClient,
    auth: undefined as unknown as AuthContextValue,
  },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

function App() {
  const auth = useAuthContext()
  return <RouterProvider router={router} context={{ queryClient, auth }} />
}

const rootElement = document.getElementById('app')!

if (!rootElement.innerHTML) {
  ReactDOM.createRoot(rootElement).render(
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <FeatureFlagsMount>
            <AuthModalProvider>
              <App />
            </AuthModalProvider>
          </FeatureFlagsMount>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
}
