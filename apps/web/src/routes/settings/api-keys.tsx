import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'

import { useAuthContext } from '#/features/auth/context'
import { ApiKeysPage } from '#/features/settings/api-keys/components/ApiKeysPage'

export const Route = createFileRoute('/settings/api-keys')({
  component: ApiKeysRoute,
})

function ApiKeysRoute() {
  const { isAuthenticated, isLoading, login } = useAuthContext()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      const redirectTo = '/settings/api-keys'
      void navigate({ to: '/', search: { redirectTo } as never }).then(() =>
        login(redirectTo),
      )
    }
  }, [isLoading, isAuthenticated, login, navigate])

  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading</span>
      </div>
    )
  }

  return <ApiKeysPage />
}
