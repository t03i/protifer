import { createFileRoute } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'

export const Route = createFileRoute('/imprint')({
  component: ImprintPage,
})

function ImprintPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Imprint</h1>
        <p className="text-sm text-muted-foreground">
          Information in accordance with § 5 TMG (German Telemedia Act) and § 18
          Abs. 2 MStV (Medienstaatsvertrag).
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Provider</h2>
        <address className="not-italic rounded-lg border bg-card p-4 text-sm leading-relaxed">
          <strong className="font-semibold">
            Technical University of Munich (TUM)
          </strong>
          <br />
          Arcisstraße 21
          <br />
          80333 München, Germany
          <br />
          <span className="text-muted-foreground">
            Public-law corporation (Körperschaft des öffentlichen Rechts)
          </span>
        </address>
        <p className="text-sm text-muted-foreground leading-relaxed">
          protifer is operated by the{' '}
          <strong className="font-semibold text-foreground">Rostlab</strong> at
          the Department of Bioinformatics &amp; Computational Biology, TUM
          School of Computation, Information and Technology, Boltzmannstraße 3,
          85748 Garching, Germany.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Legal representative</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          TUM is legally represented by the President,{' '}
          <span className="text-foreground">Prof. Dr. Thomas F. Hofmann</span>.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">VAT identification number</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          VAT-ID pursuant to § 27a UStG:{' '}
          <span className="font-mono text-foreground">DE811193231</span>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Supervisory authority</h2>
        <address className="not-italic rounded-lg border bg-card p-4 text-sm leading-relaxed">
          Bavarian State Ministry of Science and the Arts
          <br />
          (Bayerisches Staatsministerium für Wissenschaft und Kunst)
          <br />
          Salvatorstraße 2
          <br />
          80333 München, Germany
        </address>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Contact</h2>
        <div className="rounded-lg border bg-card p-4 text-sm leading-relaxed">
          <p>
            <span className="text-muted-foreground">Email:</span>{' '}
            <a
              href="mailto:assistant@rostlab.org"
              className="text-primary hover:underline"
            >
              assistant@rostlab.org
            </a>
          </p>
          <p>
            <span className="text-muted-foreground">Web:</span>{' '}
            <a
              href="https://rostlab.org"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              rostlab.org
              <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">
          Responsible for journalistic-editorial content (§ 18 Abs. 2 MStV)
        </h2>
        <address className="not-italic rounded-lg border bg-card p-4 text-sm leading-relaxed">
          Prof. Dr. Burkhard Rost
          <br />
          Boltzmannstraße 3
          <br />
          85748 Garching, Germany
        </address>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Online dispute resolution</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The European Commission provides a platform for online dispute
          resolution (ODR), available at{' '}
          <a
            href="https://ec.europa.eu/consumers/odr/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            ec.europa.eu/consumers/odr
            <ExternalLink className="h-3 w-3" />
          </a>
          . We are neither obliged nor willing to participate in dispute
          resolution proceedings before a consumer arbitration board.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Disclaimer</h2>

        <div className="space-y-2">
          <h3 className="text-base font-semibold">Liability for content</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The contents of this web service have been created with the utmost
            care. However, we cannot guarantee the accuracy, completeness, or
            timeliness of the content. protifer predictions are for research
            purposes only and must not be used for clinical diagnosis or
            treatment decisions.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-semibold">Liability for links</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Our web service contains links to external websites over which we
            have no control. We therefore accept no liability for the content of
            these external sites. The respective provider or operator of the
            linked pages is always responsible for their content.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-semibold">Copyright</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Content created by the operators on these pages is subject to German
            copyright law. Duplication, processing, distribution, or any form of
            commercialisation beyond the scope of copyright law requires the
            written consent of the respective author or creator.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Open source</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          protifer is open-source software. The source code is available on{' '}
          <a
            href="https://github.com/t03i/protifer"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            github.com/t03i/protifer
            <ExternalLink className="h-3 w-3" />
          </a>
          .
        </p>
      </section>
    </article>
  )
}
