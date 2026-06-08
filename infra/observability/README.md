# Sentry data scrubbing (repo-owned)

`sentry-pii.json` is the source of truth for the shared Sentry project's
`relayPiiConfig` (Advanced Data Scrubbing). It redacts ≥20-residue canonical
amino-acid runs at ingest — the defense-in-depth net behind the in-code
`beforeSend` scrub and the `{ sequenceHash, seqLen }` descriptor.

GitOps, mirroring `infra/monitoring` alert rules:

- **PR** — `ci.yml` validates the JSON shape.
- **`main`** — `build.yml`'s `sentry-pii-sync` job `PATCH`es the project with this
  file via the Sentry API.

**Do not edit scrubbing in the Sentry UI** — the sync replaces the project's
advanced rules, so UI edits are overwritten. Change the rule here.

The DSN must not be enabled in any environment carrying real sequences until
this config is synced.
