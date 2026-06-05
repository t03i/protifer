import { useState } from 'react'

import { useDeleteApiKey } from '../hooks/use-api-keys'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'

interface Props {
  trigger: React.ReactNode
  keyId: string
  keyName: string | null
}

export function RevokeKeyDialog({ trigger, keyId, keyName }: Props) {
  const [open, setOpen] = useState(false)
  const del = useDeleteApiKey()

  async function handleConfirm() {
    try {
      await del.mutateAsync(keyId)
      setOpen(false)
    } catch {
      // Error rendered below via del.error
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
          <AlertDialogDescription>
            Requests using {keyName ? `"${keyName}"` : 'this key'} will start
            failing with 401 immediately. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {del.error ? (
          <p role="alert" className="text-sm text-destructive">
            {del.error.message}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              void handleConfirm()
            }}
            disabled={del.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {del.isPending ? 'Revoking…' : 'Revoke key'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
