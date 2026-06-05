import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'

interface Props {
  open: boolean
  apiKey: string | null
  keyName: string | null
  onClose: () => void
}

export function RevealKeyDialog({ open, apiKey, keyName, onClose }: Props) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!apiKey) return
    await navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setCopied(false)
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>API key created</DialogTitle>
          <DialogDescription>
            Copy your key now. We will not show it again — closing this dialog
            erases it from memory.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {keyName ? (
            <p className="text-sm text-muted-foreground">
              Key label: <span className="font-medium">{keyName}</span>
            </p>
          ) : null}
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
            <code
              data-testid="reveal-key-value"
              className="flex-1 break-all font-mono text-sm"
            >
              {apiKey ?? ''}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleCopy}
              disabled={!apiKey}
              aria-label="Copy API key"
            >
              {copied ? (
                <>
                  <Check className="mr-1 h-4 w-4" /> Copied
                </>
              ) : (
                <>
                  <Copy className="mr-1 h-4 w-4" /> Copy
                </>
              )}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
