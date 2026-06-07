# Tasks — Idempotent OCI model deployment

> Fresh branch off `main`. The abandoned `refactor/simplify-model-deployment`
> manifest work (and the cross-language `manifest_schema.py` / schema-parity guard
> it described) is **not** present here and is not carried over. Packaging follows
> Docker's "OCI artifacts for AI model packaging" strategy: OCI artifact + typed
> config blob + per-file uncompressed content-addressed blobs.

## 0. Confirm before building the cache path

- [x] 0.1 Confirm per-model `version` = **content-derived sha256** of the model
      dir (design Decision 4). Confirms existing `…/v1/…` keys are intentionally
      reset (safe pre-prod; no warm cache).

## 1. Local build script (producer)

- [x] 1.1 Assemble the complete `/models` tree from `model-repository/` + local
      ONNX weights; stage `_envs/cpu_py312.tar.gz`.
- [x] 1.2 Build the conda env in a **`linux/amd64` Docker stage** (micromamba +
      conda-pack, relocated from `Dockerfile.init`) so it is correct + reproducible
      on arm64 build hosts (Mac M4). Cache the produced tarball.
- [x] 1.3 Run `onnx.checker` at build time over ONNX models; fail the build on
      structural errors (was runtime in `init_models.py`).
- [x] 1.4 Derive per-model `version = sha256(model_dir)` (Decision 4) and assemble
      the inventory **config blob** (`triton`/`id`/`role`/`version`; `internal`
      omits `id`) with custom mediaType
      (`application/vnd.protifer.model-inventory.v1+json`).
- [x] 1.5 `oras push` to `ghcr.io/<org>/model-repo` as **per-file uncompressed
      blobs** (oras native multi-file layout; path in the title annotation) + the
      config blob. No whole-tree tar, no gzip on weights — determinism is
      intrinsic per Decision 1b.
- [x] 1.6 Emit the immutable digest for the deploy repo to pin.
- [x] 1.7 Strip `scripts/build-model-archives.py`: drop sidecars and GitHub-Release
      asset orchestration; the deterministic-tar dance is superseded by per-file
      content addressing (not preserved — no tar to make deterministic).

## 2. Thin init + serving

> The **prod** `model-init`/Triton wiring is deploy-repo-owned (contract below);
> the monorepo realizes it only in the dev `cpu-triton` profile and deletes the
> old init code. Do **not** add prod stack files, org names, or digests here.

- [x] 2.1 (deploy contract — document, don't implement in monorepo) `model-init`
      one-shot = **stock public `oras` image** running `oras pull $MODEL_ARTIFACT_REF`
      into a fresh dir + atomic repoint to Triton's `--model-repository` target
      (full replacement). No custom init image, no ONNX/conda runtime deps.
- [x] 2.2 (deploy contract — document, don't implement in monorepo) Triton runs
      `--model-control-mode=none` with init-completion gating startup
      (`depends_on: { model-init: service_completed_successfully }`); the
      `--load-model` list is gone (artifact is the served set).
- [x] 2.3 Realize 2.1/2.2 in the monorepo **dev `cpu-triton` profile only**
      (see 6.2).
- [x] 2.4 Delete `infra/triton/init_models.py` entirely and the standalone runtime
      `infra/triton/Dockerfile.init`.

## 3. Remove the GitHub-Releases distribution surface

- [x] 3.1 Remove the `MODEL_MANIFEST_URL` distribution path from
      `.github/workflows/triton-ci.yml`.
- [x] 3.2 Rework/remove `infra/triton/tests/triton_ready_check.py` and
      `smoke_manifest_download.py` (they read the model list from
      `MODEL_MANIFEST_URL`).
- [x] 3.3 Remove the manifest-resolution tests in `infra/triton/tests/test_manifest.py`
      tied to URL/PATH resolution and `.installed-sha256` markers.
- [x] 3.4 Remove sha256 sidecar/inline-hash logic superseded by OCI digests.
- [x] 3.5 Keep a **lightweight CI guard** over checked-in `model-repository/`
      configs (ensemble steps present + pbtxt layout) — replaces the `onnx.checker`
      / completeness enforcement that moved local (Decision 7). Confirm `model-guards.yml`
      retains the archive-determinism/layout sentinels that still apply; drop only
      the manifest-parity step that no longer has a manifest to check.

## 4. Gateway — inventory from artifact config blob

- [x] 4.1 `packages/shared`: Zod inventory schema + reader over the OCI config blob
      (`oras manifest fetch-config` / registry GET); checked-in file-source fallback
      for dev.
- [x] 4.2 `config/schema.ts`: add `MODEL_ARTIFACT_REF` (the digest, shared with
      init per C1) + inventory source; retire `MODELS_VERSION`.
- [x] 4.3 `config/suites.ts`: build `PredictionSuiteConfig` from inventory (filter
      `role != internal`); map `id`→`triton`; fail fast at boot on unknown `id` and
      on unreachable config (loud, no stale fallback).
- [x] 4.4 Cache version source flip: `suites.ts` reads each model's own `version`
      from inventory (per-model) instead of the shared `MODELS_VERSION`. **`hash.ts`
      is untouched** — the `emb/{name}/{version}/{hash}` format already exists
      (Decision 4).
- [x] 4.5 Update `suites.test.ts` (drop the `MODELS_VERSION`-applies-to-all test);
      add the unknown-`id` guard test and a per-model-version flow test.

## 5. Wire-version sever (carried into this change)

- [x] 5.1 `embedding-worker/processor.ts`: omit `model_version` (Triton `latest`).
      Required: content-derived versions are non-numeric and Triton rejects them as
      a wire `model_version`.
- [x] 5.2 Real-Triton-shaped mock test rejecting non-numeric `model_version`; assert
      both worker paths pass; confirm prediction adapters already omit it (verified:
      no `model_version` in dispatch/adapters).

## 6. Dev + deploy wiring

- [x] 6.1 Checked-in dev inventory file; gateway reads it as the config-blob
      equivalent (mock-triton path unchanged, no `oras pull` in default dev).
- [x] 6.2 Dev `docker-compose*.yml` **only**: opt-in `cpu-triton` profile that
      `oras pull`s from a _local_ registry, init→triton ordering,
      `--model-control-mode=none`. Use a placeholder `MODEL_ARTIFACT_REF` (local
      registry / `<org>`); no prod org, host, or digest in the monorepo. Prod
      compose stays in the deploy repos.
- [x] 6.3 Copy `infra/.env.dev` into this worktree before bringing the stack up
      (currently absent — `test:int` blocked until present).
- [x] 6.4 Hand off two items to the deploy-repo runbook (note only, no values
      here): GHCR retention (keep last N + pinned prod) and the gateway's GHCR
      read credential. The C1 same-digest invariant (gateway + init share one
      `MODEL_ARTIFACT_REF`) is part of this hand-off.

## 7. Quality gates

- [x] 7.1 `bun run typecheck && bun run lint && bun run format && bun run test`
- [ ] 7.2 `bun run test:int` (stack up) — pipeline caches/keys by per-model version
- [x] 7.3 Python guard suite green after removals
- [x] 7.4 `bun run build`
- [ ] 7.5 Manual: dedup drill — change one model, rebuild+push, confirm only that
      model's blobs transfer (unchanged blobs skipped).
- [ ] 7.6 Manual: rollback drill — deploy A, deploy B, repin A's digest, confirm
      `/models` == A with no host touch.
- [ ] 7.7 PR; check CI ~5 min after open.
