import { createFileRoute } from '@tanstack/react-router'

import { HeroInput } from '#/components/landing/HeroInput'
import { HistoricalLineage } from '#/components/landing/HistoricalLineage'
import { HowItWorks } from '#/components/landing/HowItWorks'
import { LoginNudge } from '#/components/landing/LoginNudge'
import { MethodCredibility } from '#/components/landing/MethodCredibility'
import { PredictionCarousel } from '#/components/landing/PredictionCarousel'
import { SequenceInput } from '#/features/input/components/SequenceInput'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

export function LandingPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <section
        aria-labelledby="hero-heading"
        className="rounded-2xl bg-brand-cream/60 px-8 py-20 text-center"
      >
        <h1
          id="hero-heading"
          className="mb-3 text-4xl font-bold tracking-tight"
        >
          protifer
        </h1>
        <p className="mx-auto mb-2 max-w-xl text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Protein Feature Inference at a glance
        </p>
        <p className="mx-auto mb-8 max-w-xl text-lg text-muted-foreground">
          Sequence-only protein feature prediction, powered by protein language
          model embeddings.
        </p>
        <div className="flex justify-center">
          <HeroInput />
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Or{' '}
          <a href="#predict" className="underline underline-offset-2">
            use the full input form below
          </a>{' '}
          for FASTA and raw sequences.
        </p>
      </section>

      <HowItWorks />

      <PredictionCarousel />

      <MethodCredibility />

      <section
        id="predict"
        aria-labelledby="predict-heading"
        className="scroll-mt-20 py-16"
      >
        <h2
          id="predict-heading"
          className="mb-6 text-center text-2xl font-semibold"
        >
          Predict a protein
        </h2>
        <div className="mx-auto max-w-2xl space-y-4">
          <SequenceInput />
          <LoginNudge />
        </div>
      </section>

      <HistoricalLineage />
    </div>
  )
}
