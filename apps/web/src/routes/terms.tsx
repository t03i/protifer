import { Link, createFileRoute } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'

export const Route = createFileRoute('/terms')({
  component: TermsPage,
})

function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Terms of Use</h1>
        <p className="text-sm text-muted-foreground">
          Last updated: April 2026
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1. Acceptance of terms</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          By accessing or using protifer (the "Service"), you agree to be bound
          by these Terms of Use. If you do not accept these terms, do not use
          the Service. The Service is operated by the Rostlab at the Technical
          University of Munich (see{' '}
          <Link to="/imprint" className="text-primary hover:underline">
            Imprint
          </Link>
          ).
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">2. Permitted use</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          protifer is provided for scientific research, educational, and
          non-commercial evaluation purposes. Both academic and commercial
          research are permitted. You may submit protein sequences, inspect
          prediction results, and use outputs to inform further research,
          provided you comply with these terms and any applicable third-party
          licences.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">3. Research use only</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Predictions produced by the Service are based on machine-learning
          models and may be incorrect, incomplete, or outdated. The Service must
          not be used as the sole basis for clinical diagnosis, clinical
          treatment decisions, or any other purpose where inaccurate results
          could endanger health, safety, or legal rights.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">4. Acceptable use</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          You agree not to:
        </p>
        <ul className="list-disc space-y-1 pl-6 text-sm text-muted-foreground leading-relaxed">
          <li>
            abuse, disrupt, or attempt to overload the Service, including
            circumventing rate limits or quotas;
          </li>
          <li>
            probe for or exploit security vulnerabilities outside of a
            responsible-disclosure process;
          </li>
          <li>
            submit content that infringes third-party rights, contains malicious
            payloads, or violates applicable law;
          </li>
          <li>
            use the Service to generate or disseminate sequences intended to
            cause harm, including potentially dangerous biological agents;
          </li>
          <li>
            redistribute the Service as your own or resell access without
            written permission.
          </li>
        </ul>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We may throttle, suspend, or revoke access if these terms are violated
          or the Service is at risk.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">5. Accounts and API keys</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Some features require an account. Sign-in is handled exclusively via
          GitHub OAuth; you must have a GitHub account and comply with{' '}
          <a
            href="https://docs.github.com/en/site-policy/github-terms/github-terms-of-service"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            GitHub's Terms of Service
            <ExternalLink className="h-3 w-3" />
          </a>{' '}
          in order to use it. The profile data we receive from GitHub is
          described in our{' '}
          <Link to="/legal" className="text-primary hover:underline">
            Privacy Policy
          </Link>
          . You are responsible for keeping your GitHub account secure, as any
          sign-in performed with it is treated as authorised by you.
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Authenticated users may create API keys for programmatic access. The
          plaintext key is shown only once at creation time; only a hashed
          fingerprint is stored afterwards. You are responsible for keeping keys
          confidential, for all activity performed with them, and for revoking
          them immediately if a key is lost or exposed. API keys inherit the
          rate limits and quotas of the account that created them and may be
          revoked by you, or by us, at any time.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">6. Intellectual property</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          protifer's source code is open-source and distributed on{' '}
          <a
            href="https://github.com/t03i/protifer"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            GitHub
            <ExternalLink className="h-3 w-3" />
          </a>{' '}
          under the licence declared in the repository. Prediction models and
          the underlying protein language models are covered by their own
          licences; see the{' '}
          <Link to="/methods" className="text-primary hover:underline">
            Methods
          </Link>{' '}
          page for attribution. Any sequence you submit remains yours — the
          Service claims no ownership over submitted content.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">7. Citation</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          If you use protifer or its outputs in a publication, please cite the
          references listed on the{' '}
          <Link to="/cite" className="text-primary hover:underline">
            Cite
          </Link>{' '}
          page. Proper citation supports continued development and funding of
          the Service.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">8. Availability</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The Service is provided on a best-effort basis. We may change,
          suspend, or discontinue any part of it at any time, with or without
          notice, including to perform maintenance or respond to security
          incidents.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">9. Disclaimer of warranties</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The Service is provided "as is" and "as available", without warranties
          of any kind, express or implied, including fitness for a particular
          purpose, accuracy, or non-infringement. No advice or information
          obtained from the Service creates a warranty not explicitly stated
          here.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">10. Limitation of liability</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          To the fullest extent permitted by law, the Rostlab, the Technical
          University of Munich, and contributors shall not be liable for any
          indirect, incidental, consequential, or punitive damages arising from
          your use of, or inability to use, the Service. Mandatory statutory
          liability (for example, under the German Product Liability Act)
          remains unaffected.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">11. Privacy</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Your use of the Service is also governed by our{' '}
          <Link to="/legal" className="text-primary hover:underline">
            Privacy Policy
          </Link>
          , which describes what data we process and why.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">12. Changes to these terms</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We may update these Terms of Use from time to time. Material changes
          will be indicated by updating the "Last updated" date above. Continued
          use of the Service after an update constitutes acceptance of the
          revised terms.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">13. Governing law</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          These Terms of Use are governed by the laws of the Federal Republic of
          Germany, without regard to conflict-of-laws principles. The place of
          jurisdiction is Munich, Germany, to the extent permitted by law.
        </p>
      </section>
    </article>
  )
}
