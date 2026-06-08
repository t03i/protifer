# frontend-deployment

## ADDED Requirements

### Requirement: The frontend ships as an immutable, sha-keyed Cloudflare Worker built in CI

The SPA (`apps/web`) SHALL be built in CI from a `main` commit and deployed to
Cloudflare Workers Static Assets via `wrangler deploy`, identified by the commit
`github.sha`. Each deploy SHALL be an immutable Worker **version** that can be
addressed and rolled back to. The build SHALL run in CI (not on Cloudflare).

#### Scenario: A push to main publishes a sha-identified frontend version

- **WHEN** a commit lands on `main` that touches deployable frontend surface
- **THEN** CI builds `@protifer/web` and `wrangler deploy`s `dist/` as a new
  Worker version tagged with that `github.sha`
- **AND** the version is immutable and listed by `wrangler versions`.

#### Scenario: The Worker serves the SPA with client-side routing fallback

- **WHEN** a user cold-loads a client route (e.g. `/predictions/<id>`)
- **THEN** the Worker returns `index.html` (single-page-application fallback)
  rather than a 404
- **AND** hashed assets are served with immutable caching.

#### Scenario: The Worker carries no API routing

- **WHEN** the deployed Worker handles any request
- **THEN** it serves only static assets (no proxy/`fetch` to the API origin)
- **AND** a frontend deploy or rollback cannot alter API availability.

### Requirement: Frontend and backend co-deploy from one commit, keyed to one sha

A single `main` build SHALL deploy the frontend and bump the backend service
image tags in the same invocation, both keyed to the same `github.sha`. Lockstep
is co-deployment; no runtime version gate is required.

#### Scenario: One build deploys both tiers at the same sha

- **WHEN** the `build.yml` run for a `main` commit completes
- **THEN** the SPA Worker version and the backend `image-tag.env` bump both
  reference that commit's `github.sha`.

#### Scenario: Backward-compatible API tolerates the deploy-straddle window

- **WHEN** an edge-cached prior SPA briefly calls the newly deployed API during a
  deploy (or vice-versa after rollback)
- **THEN** the versioned `/v1` API remains backward-compatible within the deploy
  window so the straddle does not break in-flight users.

### Requirement: Rollback is a single sha-keyed operator action

Rolling the frontend and backend back SHALL be one operator action taking a
target `github.sha`: revert the backend `image-tag.env` bump (so `doco-cd`
reconverges with no host touch) and `wrangler rollback` the SPA to the version
for that sha.

#### Scenario: One dispatch rolls both tiers back to a prior sha

- **WHEN** an operator triggers the rollback workflow with a prior `github.sha`
- **THEN** the backend converges to that sha's images via `doco-cd`
- **AND** the SPA serves that sha's Worker version
- **AND** no SSH or manual host edit is required.

### Requirement: Frontend and API share a registrable domain so auth is first-party-clean

The SPA SHALL be served from `protifer.app` and the API addressed at
`api.protifer.app` — both subdomains of the same registrable domain. The
cross-subdomain request SHALL be same-site so the `SameSite=Lax` session cookie
is sent on credentialed requests without `SameSite=None`, a cookie `Domain`
rewrite, or dependence on third-party-cookie allowances. Cross-origin access SHALL
be governed by the existing CORS configuration (no new app code).

#### Scenario: Authenticated XHR carries the session cookie cross-subdomain

- **WHEN** a signed-in user on `protifer.app` makes a credentialed request to
  `api.protifer.app`
- **THEN** the browser sends the `SameSite=Lax` session cookie (same-site)
- **AND** the gateway CORS layer reflects the specific origin `https://protifer.app`
  with `Access-Control-Allow-Credentials: true` (not `*`).

#### Scenario: GitHub OAuth completes across the split origin

- **WHEN** a user signs in with GitHub
- **THEN** the flow initiates and the callback resolves on `api.protifer.app`,
  setting the session cookie on a top-level navigation
- **AND** the final redirect to `protifer.app` is accepted because it is a trusted
  origin.

### Requirement: The API origin is reachable only through Cloudflare

`api.protifer.app`'s origin SHALL NOT be publicly reachable except through
Cloudflare (a Cloudflare Tunnel from the app-tier host, with no public inbound).
The Tunnel and its identifiers are deploy-side owned; the monorepo SHALL NOT carry
account, zone, or tunnel identifiers or credentials.

#### Scenario: A directly-addressed origin is not a Cloudflare bypass

- **WHEN** the API origin is provisioned for `api.protifer.app`
- **THEN** it accepts traffic only via Cloudflare (Tunnel), not a public port
- **AND** no Cloudflare/account/tunnel credential or identifier appears in the
  monorepo.
