# Idempotent OCI model deployment

## Why

The deployed Triton model repository is currently produced by an **imperative,
non-reconciling init container** mutating a **persistent volume**:

- `infra/triton/init_models.py` downloads each archive (from a GitHub-Releases
  manifest via `MODEL_MANIFEST_URL`/`MODEL_MANIFEST_PATH`), verifies a
  hand-rolled `sha256`, extracts into `/models`, and writes `.installed-sha256`
  idempotence markers. It **iterates the manifest and only ever adds/overwrites**
  — it never removes a model that is on the volume but absent from the desired
  set (no prune path exists).
- Triton runs `--model-control-mode=explicit`; the served set is changed by
  load/unload calls or a restart with `--load-model` flags, not by the desired
  state alone.

So **desired state (a tag) ≠ actual state (a hand-mutated volume).** The failure
this creates is the rollback path: deploy a bad model, and reverting means
SSHing to the host, deleting the offending directory, and reloading Triton by
hand. That breaks the no-touch `doco-cd` continuous-deployment contract the
deploy repos rely on (a ref bump must be the only operator action).

Three more costs ride along:

1. **A 2 GB ceiling.** `init_models.py` already special-cases models > 2 GB.
   Real artifacts (prott5_xl, the incoming ESM2 — already staged under
   `model-repository/_deferred/`) exceed GitHub Releases' 2 GB per-asset limit;
   the current GitHub-Releases distribution is a dead end the moment ESM2 is
   activated.
2. **A bake-then-stage conda dance.** The CPU conda-pack execution environment
   Triton's python backends need (`_internal_prott5_tokenizer`, `_tmbed_viterbi`
   reference `EXECUTION_ENV_PATH` → `_envs/cpu_py312.tar.gz`) is built in
   `Dockerfile.init`, baked into the init image, then copied into the volume at
   runtime by `stage_execution_env()` — a second imperative step coupled to the
   init image.
3. **Runtime ONNX/conda dependencies in the init path.** `onnx.checker`
   validation runs at deploy time inside the init container, so the init image
   carries heavyweight ONNX/conda deps purely to gate something that is fixed at
   build time (the artifact is immutable).

## What Changes

> Packaging follows Docker's "OCI artifacts for AI model packaging" strategy:
> a custom OCI **artifact** (not a runnable image) with a typed config blob for
> metadata and per-file uncompressed content-addressed blobs.

- **The complete Triton model repository becomes a single immutable OCI artifact**
  built locally and pushed to GHCR with ORAS — all model directories, internal
  ensemble pieces, **and** the `_envs/cpu_py312.tar.gz` conda execution
  environment. The artifact _is_ the desired `/models` state; integrity is the OCI
  digest (no sidecars, no inline hashes); OCI blobs chunk natively (no 2 GB
  ceiling). Model changes are rare and contained, so the build is a **local
  script** (`oras push`), not a CI job.
- **Deployment is a pinned digest; rollback is the previous digest.** The deploy
  repo sets `MODEL_ARTIFACT_REF=ghcr.io/<org>/model-repo@sha256:…`; `doco-cd`
  reconverges on a ref change with **no server touch**. Rollback = revert the ref
  bump. (The pin, the prod stack wiring, and the rollback runbook are
  deploy-repo-owned — see _Repo boundary_.)
- **A thin `oras pull` one-shot replaces the init container.** Triton cannot read
  an OCI artifact directly (it supports local/S3/GCS/Azure repos only), so a
  one-shot must materialize the artifact into the volume Triton reads. That
  one-shot is the **stock public `oras` image** (`command: pull …`) — no
  maintained init image, no project code — pulling into a fresh dir and atomically
  repointing (full replacement, no accrete). Triton runs with
  **`--model-control-mode=none`** and starts only after the pull completes
  (init-completion gates startup), loading the complete repo. This deletes
  `init_models.py`, the standalone `Dockerfile.init`, and the `--load-model`
  desired-state list. `onnx.checker` moves to **build time**, so nothing at
  runtime carries ONNX/conda deps.
- **The gateway reads model inventory from the artifact config blob, not a
  downloaded manifest.** The artifact carries the model list (`triton`, `id`,
  `role`, and a per-model `version`) as a typed OCI **config blob**; the gateway
  fetches only that config (zero model bytes). Today the gateway hardcodes the
  suite (`buildSuiteV1`) and reads a single `MODELS_VERSION` env — this
  **replaces the hardcoded suite with metadata** so the served set and cache
  identity are derived from the deployed artifact. Inventory validation is a
  single-language (TS/Zod) concern. **New dependency, stated honestly:** the
  gateway now needs GHCR read access at boot and fails loud if the config is
  unreachable.
- **Per-model `version` becomes the cache tag**, sourced from metadata. The cache
  key format is **already** `emb/{name}/{version}/{seqHash}` and per-model
  `version` already exists on `EmbeddingModelConfig`/`PredictionModelVersion`;
  the only change is the _source_ — `suites.ts` stops assigning one shared
  `MODELS_VERSION` literal to every model and instead reads each model's own
  version from metadata. Adding ESM2 leaves prott5's version (and warm cache)
  untouched; retraining prott5 moves its version and invalidates only its cache;
  a rollback rolls per-model versions back too, so old cache entries stay valid.
- **The Triton wire `model_version` is severed from any suite/cache version**:
  the embedding worker omits `model_version` → Triton `latest`. (Carried into
  this change; not yet on `main`. Required because content-derived versions are
  non-numeric and Triton would reject them as a wire `model_version`.)

## Impact

- Affected specs: `model-deployment` (new capability on this branch).
- Removed surface (monorepo):
  - `infra/triton/init_models.py` — the whole download/verify/extract/
    idempotence-marker/manifest-parse path and `stage_execution_env()`.
  - `infra/triton/Dockerfile.init` — the standalone runtime init image (its
    conda env-builder is relocated to a `linux/amd64` Docker stage the local
    build script invokes).
  - GitHub-Releases distribution: the `MODEL_MANIFEST_URL` path in
    `.github/workflows/triton-ci.yml`, `infra/triton/tests/triton_ready_check.py`,
    `smoke_manifest_download.py`, and the manifest-resolution tests in
    `test_manifest.py`.
  - sha256 sidecars + GitHub-Release asset orchestration in
    `scripts/build-model-archives.py`.
- Retained safety net:
  - a **lightweight CI guard** over the checked-in `model-repository/` configs
    (ensemble steps present, pbtxt layout) — cheap, needs no weights — replacing
    what the local build's `onnx.checker` no longer enforces in CI.
- New / reworked code (monorepo):
  - local build script: assemble `/models` (incl. `_envs/`, conda env built in a
    `linux/amd64` Docker stage), run build-time `onnx.checker`, derive per-model
    `version`, `oras push` as **per-file uncompressed content-addressed blobs**
    (intrinsic determinism → unchanged files skip transfer) + the typed config
    blob, print the immutable digest.
  - `packages/shared` — OCI config-blob inventory reader (TS/Zod, single
    language); checked-in file-source fallback for dev.
  - `services/api-gateway/src/config/suites.ts` + `schema.ts` — derive suite +
    per-model cache version from the config blob; add `MODEL_ARTIFACT_REF`; retire
    `MODELS_VERSION`.
  - `services/embedding-worker/src/processor.ts` — sever Triton wire version.
  - `infra/docker-compose*.yml` — **dev only**: the opt-in `cpu-triton` profile
    (`oras pull` from a local registry, `--model-control-mode=none`); default dev
    keeps mock-triton + the checked-in dev inventory.

## Repo boundary (no fleet-private detail in the monorepo)

This change spans two trust zones. The split, mirroring the existing
`<deploy-org>/deploy-{app,state}` convention:

- **Monorepo (this change) owns:** the local build/push script, the gateway /
  worker / shared TypeScript, the checked-in dev inventory, the dev compose
  (`cpu-triton` profile), and the lightweight CI config guard. It references the
  deploy side only abstractly — `ghcr.io/<org>/model-repo`, `MODEL_ARTIFACT_REF`,
  `doco-cd` — never a concrete org, host, digest, or registry credential.
- **Deploy repos own (contract, not implemented here):** the prod stack wiring
  (the `model-init` `oras pull` service, the Triton service, the shared volume,
  `--model-control-mode=none`), the `MODEL_ARTIFACT_REF` digest pin, GHCR read
  credentials, the GHCR retention policy (keep last N + pinned prod), and the
  rollback runbook. These are described as a deploy contract only; their concrete
  values and topology stay in the private deploy repos.

## Non-goals

- No model retraining or new ONNX artifacts (models stay frozen except ESM2
  onboarding, which becomes a "move out of `_deferred/` + rebuild the image"
  step).
- No move to baking models into the Triton **server** image (the separate
  model-image + image-as-init shape is chosen; the model image is distinct from
  the stock `tritonserver` image — see design.md).
- No multi-version Triton serving (single numeric dir per model; `latest`).
- No hosted/3rd-party registry — GHCR, consistent with existing GHCR image
  publishing.
- No CI-built model image — the build is local (rare, contained changes).
