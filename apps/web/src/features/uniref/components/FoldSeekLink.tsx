import { ExternalLink } from 'lucide-react'

import { Button } from '#/components/ui/button'

interface Props {
  accession: string
}

export function FoldSeekLink({ accession }: Props) {
  return (
    <Button variant="outline" size="sm" asChild>
      <a
        href={`https://search.foldseek.com/search?accession=${accession}&source=uniprot`}
        target="_blank"
        rel="noreferrer"
      >
        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
        FoldSeek
      </a>
    </Button>
  )
}
