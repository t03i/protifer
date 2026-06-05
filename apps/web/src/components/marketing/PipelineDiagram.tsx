import pipelineSvg from '#/assets/marketing/pipeline.svg?raw'
import { cn } from '#/lib/utils'

interface Props {
  className?: string
}

export function PipelineDiagram({ className }: Props) {
  return (
    <figure
      className={cn('w-full text-foreground', className)}
      aria-label="Prediction pipeline diagram"
    >
      <div
        className="mx-auto w-full max-w-4xl [&>svg]:h-auto [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: pipelineSvg }}
      />
      <figcaption className="sr-only">
        A protein sequence is embedded by ProtT5 and then fed to per-residue
        predictors (secondary structure, topology, disorder, binding,
        conservation, variant effect) and per-protein predictors (subcellular
        localisation, Gene Ontology, 3D structure lookup).
      </figcaption>
    </figure>
  )
}
