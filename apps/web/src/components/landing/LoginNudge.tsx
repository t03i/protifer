import { Github } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { useAuthContext } from '#/features/auth/context'

export function LoginNudge() {
  const { isAuthenticated, isLoading, login } = useAuthContext()

  if (isLoading || isAuthenticated) return null

  return (
    <p className="text-center text-sm text-muted-foreground">
      <Button
        variant="link"
        size="sm"
        className="h-auto gap-1 p-0 text-sm"
        onClick={() => login(window.location.pathname)}
      >
        <Github className="h-3 w-3" />
        Sign in with GitHub
      </Button>{' '}
      for higher rate limits and prediction history.
    </p>
  )
}
