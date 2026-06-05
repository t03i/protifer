import { ExternalLink } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import type { Method } from '#/content/methods'

interface Props {
  method: Method
}

export function MethodCard({ method }: Props) {
  return (
    <Card
      id={method.slug}
      className="scroll-mt-20 border-brand-sage/20 bg-card"
    >
      <CardHeader>
        <CardTitle className="text-base">{method.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{method.summary}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="font-semibold">Input</dt>
          <dd className="text-muted-foreground">{method.inputs}</dd>
          <dt className="font-semibold">Output</dt>
          <dd className="text-muted-foreground">{method.outputs}</dd>
        </dl>
        <p className="text-xs italic text-muted-foreground">
          {method.citation}
        </p>
        <a
          href={`https://doi.org/${method.doi}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          doi:{method.doi}
          <ExternalLink className="h-3 w-3" />
        </a>
      </CardContent>
    </Card>
  )
}
