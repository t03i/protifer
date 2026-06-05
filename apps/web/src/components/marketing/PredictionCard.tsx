import { ExternalLink } from 'lucide-react'

import { Badge } from '#/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { methodBySlug } from '#/content/methods'
import type { PredictionShowcase } from '#/content/predictions'

interface Props {
  prediction: PredictionShowcase
}

export function PredictionCard({ prediction }: Props) {
  const method = methodBySlug(prediction.methodSlug)

  return (
    <Card className="h-full border-brand-sage/20 bg-brand-cream/50">
      <CardHeader className="pb-3">
        <div
          className="aspect-video overflow-hidden rounded-md bg-background p-2 text-foreground [&>svg]:h-full [&>svg]:w-full"
          role="img"
          aria-label={`${prediction.title} preview`}
          dangerouslySetInnerHTML={{ __html: prediction.thumbnailSvg }}
        />
        <CardTitle className="mt-3 text-base">{prediction.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {prediction.description}
        </p>
        <div className="flex flex-wrap gap-1">
          {prediction.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
        {method && (
          <a
            href={`https://doi.org/${method.doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            powered by {method.name}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </CardContent>
    </Card>
  )
}
