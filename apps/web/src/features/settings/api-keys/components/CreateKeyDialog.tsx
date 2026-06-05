import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { useCreateApiKey } from '../hooks/use-api-keys'
import type { CreatedKey } from '../hooks/use-api-keys'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

const DEFAULT_EXPIRY_DAYS = 30

interface Props {
  trigger: React.ReactNode
  onCreated: (key: CreatedKey) => void
}

export function CreateKeyDialog({ trigger, onCreated }: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [noExpiry, setNoExpiry] = useState(false)
  const [labelError, setLabelError] = useState<string | null>(null)
  const create = useCreateApiKey()

  function reset() {
    setName('')
    setNoExpiry(false)
    setLabelError(null)
    create.reset()
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (name.trim() === '') {
      setLabelError('Label is required')
      return
    }
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        expiresInDays: noExpiry ? null : DEFAULT_EXPIRY_DAYS,
      })
      onCreated(created)
      reset()
      setOpen(false)
    } catch {
      // Error rendered below via create.error
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Give this key a label so you can recognize it later.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="api-key-label">Label</Label>
            <Input
              id="api-key-label"
              value={name}
              autoFocus
              placeholder="e.g. CI pipeline"
              onChange={(e) => {
                setName(e.target.value)
                if (labelError) setLabelError(null)
              }}
              aria-invalid={labelError !== null}
            />
            {labelError ? (
              <p role="alert" className="text-xs text-destructive">
                {labelError}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                id="api-key-no-expiry"
                type="checkbox"
                checked={noExpiry}
                onChange={(e) => setNoExpiry(e.target.checked)}
                className="h-4 w-4"
              />
              <Label
                htmlFor="api-key-no-expiry"
                className="text-sm font-normal"
              >
                Never expires (default: expires in {DEFAULT_EXPIRY_DAYS} days)
              </Label>
            </div>
            {noExpiry ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>Non-expiring key</AlertTitle>
                <AlertDescription>
                  A key that never expires is valid until you revoke it. If it
                  leaks, anyone holding it can act as you until you notice and
                  revoke it manually. Prefer a fixed expiry and rotate on
                  schedule.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          {create.error ? (
            <p role="alert" className="text-sm text-destructive">
              {create.error.message}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false)
                reset()
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create key'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
