# model-deployment Specification

## Purpose

TBD - created by archiving change idempotent-model-deploy. Update Purpose after archive.

## Requirements

### Requirement: Deployed model repository is a single immutable OCI artifact

The system SHALL publish the complete Triton model repository — every model
directory, internal ensemble piece, and the `_envs/` conda execution
environment — as one content-addressed OCI artifact to GHCR. The artifact digest
SHALL be the integrity check; the system SHALL NOT maintain sidecar checksums or
inline per-file hashes for distribution. The artifact SHALL carry model files as
**per-file uncompressed content-addressed blobs** (no whole-tree tar), so that
unchanged files dedup on push and pull.

#### Scenario: The artifact is the complete model repository

- **WHEN** the artifact is pulled into an empty location
- **THEN** the resulting tree is a valid Triton `--model-repository` with all
  declared models present
- **AND** `_envs/cpu_py312.tar.gz` is present so python-backend models
  (`_internal_prott5_tokenizer`, `_tmbed_viterbi`) resolve `EXECUTION_ENV_PATH`.

#### Scenario: Large models are not size-capped

- **WHEN** a model artifact exceeds 2 GB (e.g. ESM2)
- **THEN** it is published and pulled as native OCI blobs without a per-asset
  size failure.

#### Scenario: Only changed files transfer on rebuild

- **WHEN** one model's weights change and the artifact is rebuilt and pushed
- **THEN** the unchanged models' blobs are skipped (already present by digest)
- **AND** only the changed file blobs (plus the small config blob) transfer.

### Requirement: Deployment is a pinned digest and rollback is no-touch

Deployment SHALL be driven by a single pinned artifact reference
(`MODEL_ARTIFACT_REF` as a `…@sha256:` digest). Changing or reverting that
reference SHALL be the only operator action required to deploy or roll back; no
manual filesystem edit or Triton command on the host SHALL be required.

#### Scenario: Rollback reverts to the prior model set with no server touch

- **WHEN** a deployed artifact is found faulty and the reference is repinned to
  the previous digest
- **THEN** the running model repository converges to exactly the previous model
  set
- **AND** no model directory from the faulty artifact remains
- **AND** no operator SSH/manual deletion/manual Triton reload is required.

#### Scenario: Deploying does not accrete orphan models

- **WHEN** an artifact that omits a previously-deployed model is deployed
- **THEN** that model is absent from the running repository (full replacement,
  not additive overlay).

### Requirement: Thin init performs full replacement and Triton serves the whole repo

The init step SHALL obtain the model repository by pulling the OCI artifact into
a fresh location and atomically pointing Triton at it. The init step SHALL NOT
mutate a previous repository in place, and SHALL NOT carry ONNX or conda runtime
dependencies (structural ONNX validation runs at build time). Triton SHALL run in
a mode where the artifact alone determines the served set (`--model-control-mode=none`),
with no separate per-model load list.

#### Scenario: Triton never observes a partial repository

- **WHEN** init is pulling a new artifact
- **THEN** Triton does not start serving until the pull completes and the pointer
  is swapped (init completion gates Triton startup).

#### Scenario: The served set equals the artifact

- **WHEN** Triton starts against a freshly pulled repository
- **THEN** every model in the artifact is loaded
- **AND** no model outside the artifact is served (no external load list).

### Requirement: Gateway derives inventory from the artifact config blob

The artifact SHALL carry the model inventory (`triton`, `id`, `role`, `version`)
as an OCI **config blob** with a custom mediaType. The gateway SHALL read
inventory from that config without downloading model bytes, and SHALL NOT
hardcode the model set. Inventory validation SHALL be single-language
(TypeScript/Zod); no Python schema mirror or cross-language parity guard SHALL
exist.

#### Scenario: Suite is built from metadata

- **WHEN** the gateway boots against an artifact whose config declares an
  `embedding` model and N `prediction` models
- **THEN** the `PredictionSuiteConfig` contains exactly those models
- **AND** `internal` entries are excluded from the suite while Triton still
  serves them.

#### Scenario: Unknown id is rejected

- **WHEN** the config carries an `embedding`/`prediction` `id` that is not a
  member of `EMBEDDING_MODELS`/`PREDICTION_MODELS`
- **THEN** the gateway fails fast at boot.

#### Scenario: Unreachable inventory fails loud

- **WHEN** the gateway cannot fetch the artifact config at boot
- **THEN** the gateway fails fast and SHALL NOT fall back to a stale or hardcoded
  suite.

### Requirement: Gateway and init consume the same pinned digest

The gateway's inventory source and the init step's pull SHALL resolve to the
**same** artifact digest, supplied by a single `MODEL_ARTIFACT_REF` variable. The
system SHALL NOT let the gateway read inventory from a mutable tag while init
materializes a different digest.

#### Scenario: Cache version matches the served model

- **WHEN** a digest is deployed
- **THEN** the per-model `version` the gateway uses for cache keys is read from
  the same digest Triton is serving
- **AND** the cache key cannot describe a model version that is not deployed.

### Requirement: Per-model version is the cache identity

The content-addressed cache key SHALL use each model's own `version` from the
artifact config (`emb/{name}/{version}/{seqHash}`; prediction keys hash in each
model's version). A change to one model's weights SHALL change only that model's
cache identity; adding or removing a different model SHALL NOT change it.

#### Scenario: Adding a model preserves unrelated cache

- **WHEN** a new embedding model is added to the artifact and the existing
  embedding model's `version` is unchanged
- **THEN** existing cache entries for the unchanged model remain valid (no
  recompute).

#### Scenario: Rollback keeps cache coherent

- **WHEN** the artifact is rolled back to a prior digest
- **THEN** each model's cache identity reverts with it
- **AND** cache entries written under the prior versions remain valid (no
  corruption, no forced recompute on roll-forward).

### Requirement: Triton wire model-version is not derived from any cache version

Workers SHALL NOT pass a cache/suite version string as the Triton gRPC
`model_version`. While the repository holds a single numeric version directory,
workers SHALL request Triton `latest` (omit `model_version`).

#### Scenario: Workers request latest

- **WHEN** either worker calls Triton `modelInfer`
- **THEN** `model_version` is omitted
- **AND** neither worker sends a non-numeric `model_version`.
