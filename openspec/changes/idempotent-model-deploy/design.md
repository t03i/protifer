# Design — Idempotent OCI model deployment

## The reframe

The win here is **state semantics**, not transport. An OCI artifact that holds
the complete `/models` tree is immutable, complete, atomic, and declarative — the
GitOps primitive that lets `doco-cd` reconverge from one ref change. The
imperative init container cannot give that, because it mutates a persistent
volume additively and never reconciles deletions.

```
                 TODAY (imperative init)            THIS CHANGE (OCI artifact)
──────────────────────────────────────────────────────────────────────────────
desired state    a tag → a download script          an artifact digest
actual state     persistent volume, additively       == the artifact, wholesale
                 mutated, never reconciled
rollback         SSH: delete dir, reload Triton       repin previous digest;
                 (manual — breaks doco-cd)            doco-cd reconverges (no touch)
integrity        hand-rolled sha256 + sidecars        OCI content digest
inventory        hardcoded suite in gateway +         typed config blob read by ts
                 MODELS_VERSION env                   (gateway, zero model bytes)
conda env        built in Dockerfile.init, baked,     part of the artifact
                 staged into volume at runtime
serving control  --model-control-mode=explicit        --model-control-mode=none
                 + --load-model desired-state list     (artifact is the only set)
```

> **Packaging strategy.** This follows Docker's documented "OCI artifacts for AI
> model packaging" approach: a **custom artifact** (not a runnable image) with a
> domain-specific **config blob** for metadata and **uncompressed, content-
> addressed layers**, distributed over a standard OCI registry (GHCR). See
> <https://www.docker.com/blog/oci-artifacts-for-ai-model-packaging/>.

> **Note on the gateway/inventory row.** Earlier drafts (carried from the
> abandoned `refactor/simplify-model-deployment` worktree) described a
> cross-language manifest seam — a Python `manifest_schema.py` dataclass mirror
> and a Py↔TS schema-parity guard. **Neither exists on this branch.** Today the
> gateway has _no_ manifest coupling at all: it hardcodes `buildSuiteV1()` and
> reads a single `MODELS_VERSION` env. So this change does not _remove_ a seam —
> it _replaces a hardcoded suite_ with artifact-derived inventory, and in doing
> so introduces a new (honest) dependency: the gateway reads GHCR at boot.

## Decision 1 — Locally-built OCI artifact (ORAS), thin oras-pull init (SETTLED)

**Decision:** Ship `/models` as its own **OCI artifact** via `oras push`, built by
a **local script**, materialized on the deploy host by a **thin `oras pull`
one-shot** into the volume Triton reads. Not baked into the Triton server image;
not a runnable model image.

- **Why an artifact, not a runnable image?** Following the Docker AI-packaging
  strategy: an artifact carries a **typed config schema** (cheap metadata reads),
  uses **uncompressed non-TAR layer formats** suited to large high-entropy
  weights, and signals that models are data, not executables. Triton can't read
  either format directly, so a one-shot must materialize content into the volume
  regardless; the artifact's per-file content-addressing (Decision 1b) is what
  buys the dedup/determinism we want.
  - _Tradeoff vs the runnable-image alternative:_ an image could self-populate the
    volume via its own entrypoint (no separate init), but it forces TAR layers
    (determinism must be forced) and a stringly-typed label for metadata. The
    artifact route needs a puller one-shot — but that puller is the stock public
    `oras` CLI image (`command: pull …`), not a maintained init image with our
    code. Net: the artifact wins on metadata + dedup; the "extra" init is free.
- **Why local, not CI?** Model changes are rare and contained, and the ONNX
  weights live outside the repo. A local `oras push` is the smallest moving part;
  CI keeps only a lightweight config guard (Decision 7).
- The deploy unit is `MODEL_ARTIFACT_REF` (`ghcr.io/<org>/model-repo@sha256:…`),
  independent of the Triton runtime image tag — decoupling model cadence from
  Triton upgrades and keeping a small blast radius.

```
 BUILD (local script)                DEPLOY HOST (doco-cd)
 ┌────────────────────────┐         ┌─────────────────────────────────────────┐
 │ assemble /models tree  │         │ model-init (stock oras image, one-shot):  │
 │  + _envs/cpu_py312.tgz │  push   │   oras pull $REF → fresh dir, then        │
 │ env built in amd64     │ ──────▶ │   atomic repoint /models (full replace)   │
 │   docker stage         │  GHCR   │ triton: depends_on completed →            │
 │ onnx.checker (here!)   │         │   --model-control-mode=none, load all     │
 │ derive per-model ver   │         │ gateway: pin same digest → fetch config   │
 │ oras push (per-file)   │         │   blob → inventory (zero model bytes)     │
 │   + typed config blob  │         └─────────────────────────────────────────┘
 │ emit @sha256 digest    │
 └────────────────────────┘
```

> **Boundary.** The left column (build script) is **monorepo**; the right column
> (deploy host) is the **deploy-repo-owned contract** — the `model-init`/Triton
> service definitions, the digest pin, GHCR creds, and retention live in the
> private `<deploy-org>/deploy-{app,state}` repos, not here. The monorepo realizes
> the deploy shape only in the dev `cpu-triton` profile (Decision 6). No concrete
> org, host, digest, or credential appears in this change.

## Decision 1b — Per-file uncompressed content-addressed blobs (SETTLED; determinism is intrinsic, not forced)

**Decision:** `oras push` the tree as **one raw, uncompressed blob per file**,
each carrying its relative path in the `org.opencontainers.image.title`
annotation (oras's native multi-file layout; `oras pull` reconstructs the
directory tree). The inventory rides the **artifact config**, not a layer. No
whole-tree tar; no gzip on weights.

**Why this is the right granularity.** OCI content-addresses _blobs_, not
files-within-blobs. A pull/push skips a blob iff its exact sha256 already exists.
Per-file raw blobs make that property work _and_ make determinism free, per the
Docker strategy: "the lack of file names, hierarchy, and metadata (e.g.
modification time) ensures that identical model files always result in identical
reusable layer blobs."

```
 artifact config = inventory JSON (tiny, typed mediaType)
 blob prott5/model.onnx      = sha256:AAA…   vespag weights change, prott5 untouched:
 blob prott5/config.pbtxt    = sha256:DDD…  →  prott5 blobs byte-identical → SKIP ✅
 blob vespag/model.onnx      = sha256:BBB…     vespag/model.onnx → new sha → transfer
 blob _envs/cpu_py312.tar.gz = sha256:EEE…     only changed file(s) (+ tiny config) move
```

- **Determinism is intrinsic.** A blob _is_ a file's raw bytes — no tar, no
  mtime/uid, no gzip header — so an untouched file yields an identical digest on
  every rebuild, regardless of build host or checkout time. This defeats both
  classic dedup-killers (one-big-tarball; non-deterministic tar) _by
  construction_, so no "deterministic-tar dance" is needed. Drop the sidecar/
  Release-asset orchestration from `build-model-archives.py`; the determinism it
  used to hand-roll is now a property of the format.
- **Finer than per-model.** A `config.pbtxt` whitespace edit moves only that tiny
  blob, not the model's weights. Per-file is strictly better than per-model dedup.
- **One determinism caveat — the conda env.** `_envs/cpu_py312.tar.gz` is a
  _produced_ gzip tar, so its blob digest is only stable if conda-pack output is
  reproducible (gzip embeds mtime). It changes rarely; cache the produced tarball
  (Decision 5) so weight-only rebuilds reuse the identical blob and it dedups.
- **Rollback re-pull:** host dedup is per-blob too, so a recent-digest rollback
  re-pulls only host-GC'd blobs — matching "mostly host-cached."

## Decision 2 — Full replacement, mode=none, no partial-read race (SETTLED)

**Decision:** The init one-shot `oras pull`s into a **fresh dir** and atomically
repoints Triton's `--model-repository` target (full replacement — no
`.installed-sha256` markers, no overwrite-in-place, no accrete). Triton starts
**only after** the one-shot completes
(`depends_on: { model-init: service_completed_successfully }`) with
**`--model-control-mode=none`**, loading the entire repo on boot.

- **Why `none` over `explicit`?** Explicit mode serves nothing unless a
  `--load-model` list enumerates the set — a _second_ desired-state declaration
  living in compose, parallel to the artifact. `none` makes the artifact the
  single source of truth: whatever's in the repo is served. Ops gets simpler; the
  `--load-model` list is deleted.
- **No partial-read race.** Triton isn't running during the pull (it waits for
  one-shot completion), so it can never observe a half-written repo — the race
  the whole change exists to kill is structurally absent. Pull-to-fresh-dir +
  atomic repoint also covers the rollback re-pull cleanly.
- **Reload on ref change.** A `MODEL_ARTIFACT_REF` change re-runs the one-shot and
  restarts Triton (brief serving gap, acceptable for infrequent model deploys).
  Rollback to a prior digest is the same path with the old ref.

## Decision 3 — Inventory via typed config blob, gateway-only (SETTLED)

**Decision:** The artifact carries the model inventory as its **config blob** with
a custom mediaType (e.g. `application/vnd.protifer.model-inventory.v1+json`); the
gateway reads it via `oras manifest fetch-config` (or a registry GET on the config
descriptor) and downloads **zero** model bytes — exactly the Docker pattern of
"fetching and parsing a small JSON file, only fetching the model itself when
needed."

```jsonc
// artifact config blob (custom mediaType)
{
  "models": [
    {
      "triton": "prot_t5_pipeline",
      "id": "prott5_xl_u50",
      "role": "embedding",
      "version": "<per-model-version>",
    },
    {
      "triton": "tmbed",
      "id": "tmbed",
      "role": "prediction",
      "version": "<per-model-version>",
    },
    {
      "triton": "_tmbed_viterbi",
      "role": "internal",
      "version": "<per-model-version>",
    },
    // internal entries omit `id`; Triton serves them, gateway ignores them
  ],
}
```

- **Config blob, not a layer file, not an annotation.** A file in a layer would
  force a model-bytes pull; OCI annotations have registry size limits and are
  awkward for a structured list. The typed config blob is the robust, cheap home
  and is what `oras` exposes as the artifact config.
- This **replaces the hardcoded `buildSuiteV1()` suite** with artifact-derived
  inventory. Validation is a single-language Zod concern in `@protifer/shared`.
  (There is no Python schema mirror or parity guard to delete — see the reframe
  note.)
- **New boot dependency, made loud.** The gateway needs GHCR read access at boot;
  if the config is unreachable it **fails fast** rather than silently falling back
  to a stale suite. Dev reads a checked-in inventory file (Decision 6).

**Name-mapping guard survives in TS:** a gateway test asserts every
`embedding`/`prediction` `id` is a known `EMBEDDING_MODELS`/`PREDICTION_MODELS`
member (the `id`↔`triton` map is data, not code).

## Decision 4 — Per-model version is the cache tag (SETTLED; content-derived; C1 invariant)

**Decision:** Each model's `version` in the inventory is its cache identity.

**The key format does not change.** `hash.ts` already produces
`emb/{name}/{version}/{seqHash}`, and per-model `version` already exists on
`EmbeddingModelConfig`/`PredictionModelVersion`. The _only_ change is the
**source**: `suites.ts:buildSuiteV1` stops stamping one shared `MODELS_VERSION`
literal onto every model and instead reads each model's own `version` from the
inventory. This is a source flip, not a cache-key rework — `hash.ts` is untouched.

```
add ESM2:        prott5 version unchanged → prott5 embedding cache SURVIVES ✅
retrain prott5:  prott5 version changes   → only prott5 cache invalidates  ✅
rollback v2→v1:  per-model versions roll back too → old cache keys still
                 valid; roll-forward needs NO recompute                    ✅
```

**Source = content-derived** (sha256 of the model dir, surfaced by the build).
Weight change ⇒ version change, automatic, impossible to forget; it makes the
dangerous case (retrain-then-rollback under a stale tag) impossible. The
hand-assigned-semantic alternative was rejected as forgettable. The one-time key
change off the frozen `"v1"` literal is free — prod is not live, so no warm cache
to preserve. (Confirmed in task 0.1.) Note this can reuse the per-file content
addressing from Decision 1b — the model dir's content identity is already
computed during the push.

**C1 — the load-bearing consistency invariant (must be explicit):** the
**gateway and the model-init MUST consume the identical pinned digest.** One
`MODEL_ARTIFACT_REF=…@sha256:X`, fed to _both_. If the gateway reads inventory
from a tag (mutable) while init materializes a different digest, the cache key
can describe a version Triton is not serving — silent cache corruption. Digest-pin
both consumers from the single deploy-repo variable.

## Decision 5 — Conda execution env built in-Docker for linux/amd64 (SETTLED)

The CPU conda-pack env (`_envs/cpu_py312.tar.gz`) that python backends reference
via `EXECUTION_ENV_PATH` (in `_internal_prott5_tokenizer`, `_tmbed_viterbi`, and
the deferred ESM2 tokenizer `config.pbtxt`) is built **inside a `linux/amd64`
Docker stage**, not natively on the build host.

- **Why in-Docker, platform-pinned?** Triton runs on `linux/amd64`; a conda-pack
  env is platform-specific (native binaries) and **cannot** be packed correctly
  by native micromamba on an arm64 build host (e.g. a Mac M4). Building the env in
  a `--platform=linux/amd64` Docker stage makes the output correct **and**
  reproducible regardless of the developer's machine architecture.
- The env-builder from `Dockerfile.init` is **relocated, not deleted**: it becomes
  a small `linux/amd64` Docker build (micromamba + conda-pack →
  `cpu_py312.tar.gz`) that the local script invokes, then stages the produced
  tarball under `_envs/` before the `oras push`. `init_models.py:
stage_execution_env()` and the standalone runtime `Dockerfile.init` are gone.
- **Build cost / determinism:** the env build is the heaviest step and its gzip
  output is the one non-intrinsically-deterministic blob (Decision 1b). Cache the
  produced `cpu_py312.tar.gz` so weight-only rebuilds reuse the identical blob;
  consider `gzip -n` / pinned mtime for byte-stability if cache misses recur.

## Decision 6 — Dev path (SETTLED)

Dev keeps `mock-triton` (no GPU, no real registry pull) and a **checked-in dev
inventory** the gateway reads as the metadata equivalent (the gateway code path
is identical; only the inventory _source_ differs: config blob in prod, file in
dev). No `oras pull` runs in the default dev stack; an opt-in `cpu-triton` profile
may pull the real artifact from a local registry for full-path testing.

## Decision 7 — Local build + retained CI guard (SETTLED)

The build is a **local script** (Decision 1). Going local removes CI enforcement
of `onnx.checker` and ensemble/layout completeness, so a **lightweight CI guard
survives** over the checked-in `model-repository/` configs: assert every ensemble
step (`platform: "ensemble"` referents) is present and the pbtxt layout is intact.
This is cheap (no weights, no push) and preserves the safety the old
`--verify-manifest` parity check actually provided.

**Local build script responsibilities:**

1. Assemble `/models`: configs from `model-repository/` + ONNX weights (local) +
   conda env built in a `linux/amd64` Docker stage → `_envs/cpu_py312.tar.gz`.
2. `onnx.checker` over ONNX models — fail the build on structural errors.
3. Derive per-model `version = sha256(model_dir)`; assemble the inventory
   (`triton`/`id`/`role`/`version`; `internal` omits `id`) as the typed config.
4. `oras push` as **per-file uncompressed blobs** + the config blob (Decision 1b).
5. **Print the immutable digest** for the deploy repo to pin.

## Risks

- **Artifact size / pull time on deploy.** Multi-GB artifact; per-file content
  addressing (Decision 1b) keeps unchanged files from re-transferring, and a
  recent-digest rollback is mostly host-cached. Deploy latency is acceptable for
  infrequent model deploys.
- **Layout mistake defeats dedup.** If the build ever collapses to a whole-tree
  tar blob (instead of per-file), per-model dedup silently vanishes. This is a
  build-script correctness property; the per-file `oras push` layout guards it.
- **GHCR retention.** Old digests must remain re-pullable for fast rollback — a
  retention policy (keep last N + pinned prod) is an ops task for the deploy repo.
- **Gateway boot dependency.** GHCR read access is now required at gateway boot
  (Decision 3); a registry outage at boot is a new failure mode — fail loud, dev
  uses the file source.
- **Triton reload gap.** A single-node restart on ref change drops requests
  briefly; mitigate with a second replica if the SLO requires.
- **Cache key migration.** Decision 4 orphans existing `…/v1/…` keys once; safe
  pre-prod, must be deliberate if a warm cache ever exists.
