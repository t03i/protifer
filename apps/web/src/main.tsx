import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { ThemeProvider } from 'next-themes'
import ReactDOM from 'react-dom/client'

import { routeTree } from './routeTree.gen'

import { AuthModalProvider } from '#/features/auth/components/AuthModalProvider'
import type { AuthContextValue } from '#/features/auth/context'
import { AuthProvider, useAuthContext } from '#/features/auth/context'
import { FeatureFlagsMount } from '#/features/flags'
import { makeSentryLogger, setLogger } from '#/lib/logger'
import { initFrontendSentry } from '#/lib/sentry'

initFrontendSentry()
if (import.meta.env['VITE_SENTRY_DSN']) setLogger(makeSentryLogger())

const queryClient = new QueryClient()

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
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
