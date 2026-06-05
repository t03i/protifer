import { Plus } from 'lucide-react'
import { useState } from 'react'

import { ApiKeysTable } from './ApiKeysTable'
import { CreateKeyDialog } from './CreateKeyDialog'
import { RevealKeyDialog } from './RevealKeyDialog'
import { useApiKeys } from '../hooks/use-api-keys'
import type { CreatedKey } from '../hooks/use-api-keys'

import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'

export function ApiKeysPage() {
  const { data: keys, isLoading, error } = useApiKeys()
  const [revealed, setRevealed] = useState<CreatedKey | null>(null)

  return (
    <div className="container mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API Keys</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Use API keys to authenticate programmatic requests with{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              Authorization: Bearer &lt;key&gt;
            </code>
            . Keys inherit your plan limits.
          </p>
        </div>
        <CreateKeyDialog
          onCreated={(k) => setRevealed(k)}
          trigger={
            <Button>
              <Plus className="mr-1 h-4 w-4" />
              New key
            </Button>
          }
        />
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error.message}
        </p>
      ) : null}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !keys || keys.length === 0 ? (
        <EmptyState />
      ) : (
        <ApiKeysTable keys={keys} />
      )}

      <RevealKeyDialog
        open={revealed !== null}
        apiKey={revealed?.key ?? null}
        keyName={revealed?.name ?? null}
        onClose={() => setRevealed(null)}
      />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <h2 className="text-base font-medium">No API keys yet</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Create your first key to start hitting the API from scripts, CI, or
        notebooks. We will show the key exactly once on creation — copy it
        somewhere safe.
      </p>
    </div>
  )
}
