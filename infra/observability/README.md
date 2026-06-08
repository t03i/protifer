# Sentry data scrubbing

The PII scrub for the shared Sentry project lives **in the SDK**, not in
server-side config. `scrubAminoAcidRuns` (`packages/shared/src/sentry-scrub.ts`)
runs in `beforeSend` on both the backend (`initSentry`) and the frontend
(`apps/web/src/lib/sentry.ts`), redacting ≥20-residue canonical amino-acid runs
from event message / exception values / breadcrumbs / request data **before the
event leaves the process**. This is Sentry's recommended primary defense and is
plan-independent.

It sits behind the `{ sequenceHash, seqLen }` descriptor discipline (sequences
are never put on events in the first place) and the frontend's key-name scrub.

## Why not server-side `relayPiiConfig`?

Custom `relayPiiConfig` rules (Advanced Data Scrubbing) are a Sentry
**Business-plan** feature; the `PUT .../projects/{org}/{project}/` sync returned
`403` on our plan, so it never actually protected anything. The CI sync job was
removed. If the project later moves to a Business plan, `sentry-pii.json` is the
ready-made `relayPiiConfig` template — re-add a sync step that `PUT`s it as the
project's `relayPiiConfig` string, as an ingest-time net behind the SDK scrub.

The canonical pattern (`[ACDEFGHIKLMNPQRSTVWY]{20,}`) must stay in sync between
`sentry-pii.json` and `AMINO_ACID_RUN` in `sentry-scrub.ts`.

The DSN must not be enabled in any environment carrying real sequences until the
SDK scrub is in place (it is).
