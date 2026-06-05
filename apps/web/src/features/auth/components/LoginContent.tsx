import { Github, Loader2 } from 'lucide-react'

import { Button } from '#/components/ui/button'

interface LoginContentProps {
  onLogin: () => void
  isPending?: boolean
  error?: string | null
  showHeading?: boolean
}

export function LoginContent({
  onLogin,
  isPending = false,
  error,
  showHeading = true,
}: LoginContentProps) {
  return (
    <div className="space-y-4">
      {showHeading && (
        <h2 className="text-lg font-semibold">Sign in to continue</h2>
      )}
      <Button
        className="gap-2 h-[44px] w-full sm:w-auto"
        disabled={isPending}
        onClick={onLogin}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Github className="h-4 w-4" />
        )}
        Sign in with GitHub
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
