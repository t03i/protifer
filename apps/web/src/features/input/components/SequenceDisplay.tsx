import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'

interface Props {
  sequence: string
  accession?: string
}

export function SequenceDisplay({ sequence, accession }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {accession ? (
            <a
              href={`https://www.uniprot.org/uniprot/${accession}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              UniProt KB · {accession}
            </a>
          ) : (
            'Sequence'
          )}
          <span className="ml-2 text-muted-foreground">
            ({sequence.length} residues)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-24 overflow-y-auto rounded bg-muted p-2 font-mono text-xs break-all">
          {sequence}
        </div>
      </CardContent>
    </Card>
  )
}
