import { PipelineDiagram } from '#/components/marketing/PipelineDiagram'

const steps = [
  {
    step: '1',
    title: 'Enter a sequence',
    description:
      'Paste a raw amino-acid sequence, a FASTA record, or a UniProt accession. The tool resolves the sequence and validates the alphabet automatically.',
  },
  {
    step: '2',
    title: 'Generate embeddings',
    description:
      'Your sequence is passed through the ProtT5 protein language model to produce per-residue and per-protein embeddings — no MSA required.',
  },
  {
    step: '3',
    title: 'Receive predictions',
    description:
      'Specialised heads read the embeddings and return structural, functional, and evolutionary predictions — all in a single API call.',
  },
] as const

export function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works-heading" className="py-16">
      <h2
        id="how-it-works-heading"
        className="mb-8 text-center text-2xl font-semibold"
      >
        How it works
      </h2>

      <PipelineDiagram className="mb-10" />

      <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
        {steps.map(({ step, title, description }) => (
          <div
            key={step}
            className="flex flex-col items-center gap-3 text-center"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-lavender/40 text-sm font-bold">
              {step}
            </div>
            <h3 className="font-semibold">{title}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
