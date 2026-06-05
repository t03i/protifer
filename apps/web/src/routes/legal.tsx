import { Link, createFileRoute } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'

export const Route = createFileRoute('/legal')({
  component: LegalPage,
})

function LegalPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground">
          Last updated: April 2026
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          This policy explains how protifer processes personal data within the
          meaning of Art. 4 No. 1 of the EU General Data Protection Regulation
          (GDPR / DSGVO). It covers the information required by Art. 13 GDPR and
          the German Telemedia Telecommunications Data Protection Act (TTDSG).
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Controller</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The controller responsible for the processing of personal data on this
          website within the meaning of Art. 4 No. 7 GDPR is:
        </p>
        <address className="not-italic rounded-lg border bg-card p-4 text-sm leading-relaxed">
          <strong className="font-semibold">
            Technical University of Munich (TUM)
          </strong>
          <br />
          represented by the President, Prof. Dr. Thomas F. Hofmann
          <br />
          Arcisstraße 21, 80333 München, Germany
          <br />
          Email:{' '}
          <a
            href="mailto:poststelle@tum.de"
            className="text-primary hover:underline"
          >
            poststelle@tum.de
          </a>
        </address>
        <p className="text-sm text-muted-foreground leading-relaxed">
          protifer is operated by the Rostlab at the TUM School of Computation,
          Information and Technology, Boltzmannstraße 3, 85748 Garching,
          Germany. Operational contact:{' '}
          <a
            href="mailto:assistant@rostlab.org"
            className="text-primary hover:underline"
          >
            assistant@rostlab.org
          </a>
          . Further details are listed in the{' '}
          <Link to="/imprint" className="text-primary hover:underline">
            Imprint
          </Link>
          .
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Data Protection Officer</h2>
        <address className="not-italic rounded-lg border bg-card p-4 text-sm leading-relaxed">
          Data Protection Officer of TUM
          <br />
          Arcisstraße 21, 80333 München, Germany
          <br />
          Email:{' '}
          <a
            href="mailto:beauftragter@datenschutz.tum.de"
            className="text-primary hover:underline"
          >
            beauftragter@datenschutz.tum.de
          </a>
          <br />
          Web:{' '}
          <a
            href="https://www.datenschutz.tum.de"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            datenschutz.tum.de
            <ExternalLink className="h-3 w-3" />
          </a>
        </address>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Overview</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          protifer stores the minimum data required to run the service. Browsing
          the site without signing in does not require a cookie or any
          consent-relevant terminal-equipment access under § 25 TTDSG. When you
          sign in with GitHub, a strictly necessary session cookie is set so
          that subsequent requests can be attributed to your account (see{' '}
          <a href="#account" className="text-primary hover:underline">
            Account &amp; authentication
          </a>
          ).
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">
          Categories of data and legal bases
        </h2>

        <div className="space-y-2">
          <h3 className="text-base font-semibold">Server log files</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            When you access the site, our hosting infrastructure automatically
            collects and temporarily stores technical access data: the
            requesting IP address, date and time of the request, the requested
            URL and HTTP method, response status, the referring URL, and the
            user-agent string. This is necessary to deliver the service, ensure
            stability and protect against abuse.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Legal basis:</span>{' '}
            Art. 6 (1) (e) GDPR in conjunction with Art. 4 (1) BayDSG (public
            task) and Art. 6 (1) (f) GDPR (legitimate interest in IT security).
            <br />
            <span className="font-semibold text-foreground">
              Retention:
            </span>{' '}
            log files are deleted or anonymised after no later than 7 days,
            unless retention is required to investigate a concrete security
            incident.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-semibold">Protein sequences</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Sequences you submit are processed by protifer's own inference
            pipeline: the Hono API gateway enqueues work on Redis (BullMQ),
            workers run embeddings and prediction heads against an NVIDIA Triton
            inference server, and the resulting embeddings and prediction
            artifacts are written to protifer-operated S3-compatible object
            storage. Raw sequences are not persisted in the relational database;
            embeddings and results are stored under a content hash of the input,
            which lets repeated submissions of the same sequence reuse the
            earlier computation. Results are also cached in your browser's
            memory for up to 3 days to avoid redundant round-trips (not in
            cookies or localStorage). Protein sequence data is not personal data
            in itself; an attribution to your account only exists for jobs
            submitted while signed in.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Legal basis:</span>{' '}
            Art. 6 (1) (b) GDPR (performance of the service you requested) for
            authenticated submissions; Art. 6 (1) (e) GDPR for anonymous
            research-purpose use.
            <br />
            <span className="font-semibold text-foreground">
              Retention:
            </span>{' '}
            cached embeddings and prediction artifacts are kept indefinitely in
            content-addressed form so identical re-submissions can be served
            from cache. You may request removal of cached artifacts associated
            with your account at any time (see{' '}
            <a href="#rights" className="text-primary hover:underline">
              Your rights
            </a>
            ).
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-semibold" id="account">
            Account &amp; authentication (GitHub OAuth)
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Sign-in is implemented with{' '}
            <a
              href="https://www.better-auth.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              better-auth
              <ExternalLink className="h-3 w-3" />
            </a>{' '}
            using GitHub as the OAuth provider. When you sign in, GitHub returns
            a minimal public profile which we store in our Postgres database:
            your GitHub user id, display name, verified email address, avatar
            URL, and the plan tier assigned to your account. We do not receive
            your GitHub password, access to private repositories, or
            organization data. A server-side session row and a signed HttpOnly
            session cookie are created; the cookie is short-lived (cached for 5
            minutes) and used only for authenticating requests to the protifer
            API.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You may revoke protifer's access from your GitHub account settings
            under <em>Applications → Authorized OAuth Apps</em> at any time.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Legal basis:</span>{' '}
            Art. 6 (1) (b) GDPR (performance of the user account contract). The
            session cookie is strictly necessary under § 25 (2) No. 2 TTDSG and
            does not require consent.
            <br />
            <span className="font-semibold text-foreground">
              Retention:
            </span>{' '}
            account records persist while the account is active; on deletion,
            personal profile fields are removed within 30 days. Session rows
            expire automatically.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-semibold">API keys</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You may create API keys to use the protifer API from scripts or
            workflows. Keys are generated on the server and only the plaintext
            value is shown to you once on creation; only a hashed fingerprint is
            kept afterwards, so we cannot recover a key on your behalf. Any
            request authenticated with a key is attributed to the user who
            created it, inherits that user's plan quotas, and can be revoked at
            any time from the API-keys page.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Legal basis:</span>{' '}
            Art. 6 (1) (b) GDPR.
            <br />
            <span className="font-semibold text-foreground">
              Retention:
            </span>{' '}
            key fingerprints are kept until you revoke the key or delete your
            account.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-semibold">
            UniProt and 3D Beacons lookups
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            When you enter a UniProt accession or protein name, a request is
            made to the public UniProt REST API (
            <a
              href="https://rest.uniprot.org"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              rest.uniprot.org
              <ExternalLink className="h-3 w-3" />
            </a>
            ) and, where applicable, to the 3D Beacons API operated by EMBL-EBI.
            These requests are issued from your browser and are subject to the
            respective providers' privacy policies.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Legal basis:</span>{' '}
            Art. 6 (1) (b)/(e) GDPR (delivery of the requested feature).
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-semibold">Analytics</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            protifer uses Rybitt for privacy-respecting analytics. No cookies
            are set and no information is read from or written to your terminal
            equipment beyond what is strictly necessary to render the page; § 25
            TTDSG consent is therefore not required. No personal data (IP
            address, user agent, persistent identifier) is stored. Only
            aggregate page-view counts and interaction events are collected,
            from which individuals cannot be re-identified.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Legal basis:</span>{' '}
            not applicable insofar as no personal data is processed; otherwise
            Art. 6 (1) (f) GDPR (legitimate interest in understanding aggregate
            usage to improve the service).
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-semibold">Error tracing</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Application errors are reported to Sentry for debugging purposes.
            Error reports may include the URL, browser type, and a stack trace,
            and — for authenticated sessions — your user id so we can
            distinguish reports. No protein sequence data is included in error
            reports.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Legal basis:</span>{' '}
            Art. 6 (1) (f) GDPR (legitimate interest in identifying and fixing
            defects). You may object at any time (see{' '}
            <a href="#rights" className="text-primary hover:underline">
              Your rights
            </a>
            ).
            <br />
            <span className="font-semibold text-foreground">
              Retention:
            </span>{' '}
            error events are retained by Sentry for no longer than 90 days.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Cookies and local storage</h2>
        <ul className="space-y-2 rounded-lg border bg-card p-4 text-sm">
          <li>
            <strong className="font-semibold">Session cookie</strong> —
            HttpOnly, Secure, SameSite=Lax. Set only after sign-in. Strictly
            necessary under § 25 (2) No. 2 TTDSG. Lifetime: session, server-side
            cache 5 minutes.
          </li>
          <li>
            <strong className="font-semibold">UI preferences</strong> — small
            non-tracking values (e.g. theme) may be written to your browser's
            localStorage. Strictly necessary to deliver the explicitly requested
            feature.
          </li>
          <li>
            <strong className="font-semibold">No tracking cookies.</strong> No
            third-party cookies are set; analytics are cookie-less.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">
          Recipients and processors (Art. 28 GDPR)
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We share personal data only with the following recipients, each on the
          basis described below.
        </p>
        <ul className="space-y-2 rounded-lg border bg-card p-4 text-sm">
          <li>
            <strong className="font-semibold">GitHub, Inc.</strong> — OAuth
            identity provider for sign-in. Joint exposure limited to the OAuth
            handshake. Subject to{' '}
            <a
              href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              GitHub's privacy statement
            </a>
            .
          </li>
          <li>
            <strong className="font-semibold">
              Functional Software, Inc. (Sentry)
            </strong>{' '}
            — error reporting, processor under Art. 28 GDPR via a data
            processing agreement.
          </li>
          <li>
            <strong className="font-semibold">Rybitt</strong> — anonymous,
            cookie-less page-view and event analytics. No personal identifiers
            are transmitted.
          </li>
          <li>
            <strong className="font-semibold">UniProt (EBI/SIB/PIR)</strong> —
            sequence database. Public API, no authentication required; lookups
            are issued by your browser.
          </li>
          <li>
            <strong className="font-semibold">3D Beacons (EMBL-EBI)</strong> —
            structural model source for UniProt accessions; lookups are issued
            by your browser.
          </li>
          <li>
            <strong className="font-semibold">Hosting provider</strong> — TUM
            on-premises infrastructure within the European Union.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Transfers to third countries</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Sign-in via GitHub and error reporting via Sentry may involve a
          transfer of personal data to the United States. Such transfers take
          place on the basis of the EU–U.S. Data Privacy Framework (Commission
          adequacy decision of 10 July 2023) where the recipient is certified
          under that framework, and otherwise on the basis of the Standard
          Contractual Clauses pursuant to Art. 46 (2) (c) GDPR together with
          appropriate supplementary measures. A copy of the safeguards may be
          requested from the Data Protection Officer.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">
          Automated decision-making and profiling
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We do not use personal data for automated decision-making, including
          profiling, that produces legal effects concerning you or similarly
          significantly affects you within the meaning of Art. 22 GDPR. Plan
          quotas and rate limits are technical safeguards and are not based on
          personal characteristics.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Provision of data</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          You are not contractually or legally obliged to provide personal data
          to use the public, anonymous parts of protifer. Creating an account
          requires the data described above; without it, the account-bound
          features (persistent history, API keys, higher quotas) cannot be
          provided.
        </p>
      </section>

      <section className="space-y-4" id="rights">
        <h2 className="text-xl font-semibold">Your rights</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          As a data subject, you have the following rights with respect to
          personal data we hold about you:
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground leading-relaxed">
          <li>
            <strong className="font-semibold text-foreground">
              Right of access
            </strong>{' '}
            (Art. 15 GDPR) — confirmation as to whether and which data we
            process and a copy thereof.
          </li>
          <li>
            <strong className="font-semibold text-foreground">
              Right to rectification
            </strong>{' '}
            (Art. 16 GDPR) — correction of inaccurate or incomplete data.
          </li>
          <li>
            <strong className="font-semibold text-foreground">
              Right to erasure
            </strong>{' '}
            (Art. 17 GDPR) — deletion of your data where the legal grounds
            apply.
          </li>
          <li>
            <strong className="font-semibold text-foreground">
              Right to restriction
            </strong>{' '}
            of processing (Art. 18 GDPR).
          </li>
          <li>
            <strong className="font-semibold text-foreground">
              Right to data portability
            </strong>{' '}
            (Art. 20 GDPR) — receive data you provided in a structured,
            machine-readable format.
          </li>
          <li>
            <strong className="font-semibold text-foreground">
              Right to object
            </strong>{' '}
            (Art. 21 GDPR) — to processing based on Art. 6 (1) (e) or (f) GDPR,
            on grounds relating to your particular situation.
          </li>
          <li>
            <strong className="font-semibold text-foreground">
              Right to withdraw consent
            </strong>{' '}
            (Art. 7 (3) GDPR) — where processing is based on consent, you may
            withdraw it at any time without affecting the lawfulness of prior
            processing.
          </li>
        </ul>
        <p className="text-sm text-muted-foreground leading-relaxed">
          To exercise any of these rights, contact us at{' '}
          <a
            href="mailto:assistant@rostlab.org"
            className="text-primary hover:underline"
          >
            assistant@rostlab.org
          </a>{' '}
          or the Data Protection Officer at{' '}
          <a
            href="mailto:beauftragter@datenschutz.tum.de"
            className="text-primary hover:underline"
          >
            beauftragter@datenschutz.tum.de
          </a>
          .
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">
          Right to lodge a complaint (Art. 77 GDPR)
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Without prejudice to any other administrative or judicial remedy, you
          have the right to lodge a complaint with a supervisory authority. The
          authority competent for TUM is:
        </p>
        <address className="not-italic rounded-lg border bg-card p-4 text-sm leading-relaxed">
          Bayerischer Landesbeauftragter für den Datenschutz (BayLfD)
          <br />
          Wagmüllerstraße 18
          <br />
          80538 München, Germany
          <br />
          Email:{' '}
          <a
            href="mailto:poststelle@datenschutz-bayern.de"
            className="text-primary hover:underline"
          >
            poststelle@datenschutz-bayern.de
          </a>
          <br />
          Web:{' '}
          <a
            href="https://www.datenschutz-bayern.de"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            datenschutz-bayern.de
            <ExternalLink className="h-3 w-3" />
          </a>
        </address>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Changes to this policy</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We may update this privacy policy to reflect changes in the service or
          in the legal framework. The current version is always available on
          this page; the date in the header indicates the most recent revision.
        </p>
      </section>
    </article>
  )
}
