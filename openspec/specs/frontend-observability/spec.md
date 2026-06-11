# frontend-observability Specification

## Purpose

Browser-side error reporting and distributed tracing for the web app via Sentry.
The capability captures uncaught render errors, promise rejections, and runtime
errors, and propagates traces to the gateway so a user action yields one
end-to-end trace across browser, gateway, and worker. It is disabled by default
and gated on `VITE_SENTRY_DSN`, running as a no-op when unset. Protein-sequence
privacy is the governing constraint: raw residues never enter any event — only a
`{ sequenceHash, seqLen }` descriptor whose hash matches the backend join key —
enforced by a `beforeSend` scrub, `sendDefaultPii: false`, and a repository-owned
server-side ingest rule synced via CI. Production stack traces are symbolicated
from source maps uploaded per `GIT_SHA` release.

## Requirements

### Requirement: Browser errors are captured to Sentry

The web app SHALL report uncaught render errors, unhandled promise rejections,
and global runtime errors to Sentry when a DSN is configured. The error boundary
(`AppErrorBoundary`) SHALL remain the user-facing fallback; Sentry capture SHALL
be additive and SHALL NOT change the boundary's user-visible behaviour. Captured
events SHALL carry a `service: web` tag and resolve `release` from the build-time
`GIT_SHA`.

#### Scenario: A render crash is captured

- **WHEN** a component throws during render in production with a DSN configured
- **THEN** `AppErrorBoundary` shows the fallback UI as before
- **AND** the error is reported to Sentry with a stack trace
- **AND** the event is tagged `service: web`.

#### Scenario: An unhandled promise rejection is captured

- **WHEN** a promise rejects with no handler
- **THEN** the rejection is reported to Sentry as an event.

### Requirement: Sentry is disabled by default and gated by DSN

The web app SHALL initialise Sentry only when `VITE_SENTRY_DSN` is a non-empty
value. When the DSN is empty or unset the SDK SHALL run in no-op mode and the app
SHALL behave identically to having no instrumentation. Initialisation SHALL be
idempotent (safe under HMR / repeated calls).

#### Scenario: No DSN means no-op

- **WHEN** the app starts with `VITE_SENTRY_DSN` empty or unset
- **THEN** no events or traces are sent
- **AND** the app's behaviour is unchanged from having no Sentry integration.

#### Scenario: Repeated initialisation is safe

- **WHEN** `initFrontendSentry()` is invoked more than once (e.g. HMR)
- **THEN** only the first call configures the SDK and subsequent calls are no-ops.

### Requirement: Raw protein sequences never enter Sentry events

The web app SHALL NOT include raw protein sequences in any Sentry event,
breadcrumb, trace, or attached context. Where sequence identity aids debugging,
the app SHALL attach a descriptor of `{ sequenceHash, seqLen }` only. The
`sequenceHash` SHALL be a SHA-256 hex digest byte-identical to the backend
`computeSequenceHash` for the same input, so it is the same join key used by the
backend submission log and the Garage cache key.

#### Scenario: Sequence-input error attaches a descriptor, not residues

- **WHEN** an error occurs while handling a sequence input and is captured
- **THEN** the event context contains `sequenceHash` and `seqLen`
- **AND** the event contains no raw residue string.

#### Scenario: Hash matches the backend join key

- **WHEN** the frontend computes `sequenceHash` for a sequence
- **THEN** the value equals the backend `computeSequenceHash` output for the same
  sequence (lowercase hex, UTF-8 bytes).

### Requirement: Events are scrubbed before and after leaving the browser

The web app SHALL apply a `beforeSend` scrub that strips query strings and known
input-field values, and SHALL set `sendDefaultPii: false`. The shared Sentry
project SHALL additionally apply a server-side data-scrubbing rule that redacts
long amino-acid runs at ingest, defined by a **repository-owned configuration**
(`infra/observability/sentry-pii.json`) validated in CI on pull requests and
synced to the project on `main` — analogous to the alert-rules GitOps flow. The
DSN SHALL NOT be enabled in any environment carrying real sequences until the
server-side rule is synced.

#### Scenario: A leaked sequence is redacted at ingest

- **WHEN** an event reaches the shared project containing a run of ≥20 canonical
  amino-acid characters
- **THEN** the matched span is replaced with a redaction placeholder before the
  event is stored.

#### Scenario: Scrub configuration is repository-owned

- **WHEN** the data-scrubbing configuration changes
- **THEN** the change is made in `infra/observability/sentry-pii.json` in the repo
- **AND** CI validates it on the pull request and syncs it to the project on
  `main`
- **AND** manual edits in the Sentry UI are not the source of truth (overwritten
  on the next sync).

#### Scenario: User identity is minimal

- **WHEN** a user is authenticated
- **THEN** events carry only the opaque better-auth `sub` as the Sentry user id
- **AND** no email, plan, or role is attached.

### Requirement: Frontend requests propagate distributed traces to the gateway

The web app SHALL attach `sentry-trace` and `baggage` headers to requests sent to
the gateway origin (`VITE_GATEWAY_URL`) and SHALL NOT attach them to third-party
origins. A user action that triggers a gateway request SHALL produce a single
trace spanning browser, gateway, and worker, viewable in the shared project.

#### Scenario: A submission yields one end-to-end trace

- **WHEN** a user submits a prediction and the request reaches the gateway
- **THEN** the gateway continues the inbound trace (existing `_sentryTrace`
  continuation)
- **AND** the resulting trace links the browser span, the gateway span, and the
  worker span under one trace id.

#### Scenario: Third-party requests are not traced

- **WHEN** the app makes a request to an origin other than `VITE_GATEWAY_URL`
- **THEN** no `sentry-trace`/`baggage` headers are attached to that request.

### Requirement: Production stack traces are symbolicated

The web production build SHALL emit source maps and the deploy pipeline SHALL
upload them to Sentry keyed by `release = GIT_SHA`. Source maps SHALL NOT be
served to end users without access control.

#### Scenario: A production error shows original source

- **WHEN** a production error is captured for a build whose source maps were
  uploaded under its `GIT_SHA`
- **THEN** the Sentry stack trace shows original (non-minified) file/line frames.
