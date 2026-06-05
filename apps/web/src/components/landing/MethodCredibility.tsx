import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'

export function MethodCredibility() {
  return (
    <section
      aria-labelledby="credibility-heading"
      className="rounded-2xl bg-brand-wheat/30 px-8 py-12 text-center"
    >
      <p className="mb-1 text-sm text-muted-foreground">Developed at</p>
      <h2 id="credibility-heading" className="mb-1 text-xl font-semibold">
        Rostlab · Technical University of Munich
      </h2>
      <p className="mx-auto mb-6 max-w-md text-sm text-muted-foreground">
        All prediction methods are peer-reviewed and published in scientific
        journals. protifer is open-source and free to use for academic and
        commercial purposes.
      </p>
      <Button variant="outline" asChild>
        <Link to="/cite">View citations</Link>
      </Button>
    </section>
  )
}
