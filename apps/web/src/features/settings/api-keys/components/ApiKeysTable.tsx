import { Trash2 } from 'lucide-react'

import { RevokeKeyDialog } from './RevokeKeyDialog'
import type { ApiKeySummary } from '../hooks/use-api-keys'

import { Button } from '#/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'

interface Props {
  keys: ApiKeySummary[]
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function ApiKeysTable({ keys }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Label</TableHead>
          <TableHead>Prefix</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead>Last used</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((k) => (
          <TableRow key={k.id}>
            <TableCell className="font-medium">{k.name ?? '—'}</TableCell>
            <TableCell>
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {k.start ?? k.prefix ?? '—'}
              </code>
            </TableCell>
            <TableCell>{formatDate(k.createdAt)}</TableCell>
            <TableCell>
              {k.expiresAt ? formatDate(k.expiresAt) : 'Never'}
            </TableCell>
            <TableCell>
              {k.lastRequest ? formatDate(k.lastRequest) : 'Never used'}
            </TableCell>
            <TableCell className="text-right">
              <RevokeKeyDialog
                keyId={k.id}
                keyName={k.name}
                trigger={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    aria-label={`Revoke ${k.name ?? 'API key'}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                }
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
