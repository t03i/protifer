import { Button } from '#/components/ui/button'

interface Props {
  error: unknown
}

export function ErrorFallback({ error }: Props) {
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred.'

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center px-4">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground max-w-md text-sm">{message}</p>
      <Button onClick={() => window.location.reload()} variant="outline">
        Reload page
      </Button>
    </div>
  )
}
