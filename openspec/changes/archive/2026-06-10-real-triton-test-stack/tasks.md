# Tasks — Stub-backed real Triton for dev & integration tests

> Branch `refactor/improved-triton-mock` off `main`. Replaces the protocol-lying
> `mock-triton` (surface #2) with a real `tritonserver` built from `py3-min` +
> python backend, serving python-identity stubs against the real ensemble
> contract. Surface #1 (fake `TritonClient` unit double) and surface #3 (prod /
> `cpu-triton`) are untouched. Sequence: build the stub image and repo, prove it
> boots and the suite passes against it, **then** delete the mock.

## 0. Spikes (settle before building — most already done 2026-06-10)

- [x] 0.1 `25.06-py3-min` exists (amd64+arm64), manifest inspectable anonymously.
- [x] 0.2 min is backend-less; python backend added via `compose.py --backend
python` (needs full `-py3` + `-py3-min` at compose time). Per NVIDIA compose docs.
- [x] 0.3 Sizes (amd64 compressed): `25.06-py3` = 11.32 GB; `25.06-py3-min` =
      6.08 GB; composed python-only stub ≈ ~6 GB. Drives §4 disk strategy.
- [x] 0.4 Real leaf backends mapped: ~15 `onnxruntime`, 2 active `python`, 3
      `ensemble`; `_deferred/*` not loaded. → python-identity-leaves approach
      (Decision 2, Option A), not config-verbatim reuse.
- [ ] 0.5 **NGC auth for layer pull** (Decision 5): attempt anonymous layer pull
      of `-py3-min`. If 401, wire `NGC_API_KEY` into the compose/push workflow
      ONLY (the PR job pulls from GHCR, not nvcr). Small.

## 1. Boot-time transform — the contract bridge (no committed copy) — DONE

- [x] 1.1 `infra/triton-stub/entrypoint.py` — at boot, reads the mounted real repo
      (`/src`, env `STUB_SRC_REPO`), derives `/models` (env `STUB_MODEL_REPO`), then
      execs `tritonserver --model-repository=/models --disable-auto-complete-config`.
      **Verified locally against the real repo: 3 ensembles + 19 leaves.**
- [x] 1.2 Ensemble models (`platform: ensemble`): config used **as-is** (byte-equal
      assert in tests) — `prot_t5_pipeline`, `tmbed`, `bind_embed`.
- [x] 1.3 Leaf models: `backend` rewritten to `"python"`, `EXECUTION_ENV_PATH`
      block + introducing comment + `default_model_filename` stripped;
      `name`/`max_batch_size`/`input`/`output`/`dims`/`data_type` preserved.
- [x] 1.4 `infra/triton-stub/identity_model.py` — ONE config-driven identity stub
      copied into every leaf `1/model.py`. Reads `model_config`, returns zeros;
      output `-1` dims from STRING content length / largest non-batch input dim /
      16 fallback (best-effort, exact only on fixed dims — see design Decision 3).
- [x] 1.5 **No committed stub repo.** Derived fresh every boot from the single
      source → cannot drift, no freshness gate (this replaced the wrong first cut
      that committed a parallel tree under `infra/triton-stub/model-repository/`).
- [x] 1.6 No conda execution env — stock interpreter + the python backend's bundled
      numpy only.
- [x] 1.7 Tests: `infra/triton/tests/test_triton_stub.py` (transform funcs +
      identity model via stubbed `pb_utils`). **12 passed locally**; picked up by the
      existing `pytest infra/triton/tests/` CI job (no new CI plumbing).

## 2. Stub image (compose.py → GHCR) — INFRA-GATED (needs Linux + nvcr pulls + GHCR push)

- [x] 2.2 **Decided: nothing baked.** The image is contract-free (tritonserver +
      python backend only); the compose stacks mount the real `model-repository`
      read-only + the two `infra/triton-stub/` python files, and `entrypoint.py`
      derives `/models` at boot then execs tritonserver with
      `--disable-auto-complete-config` (the `cpu-triton` lesson — strict configs;
      auto-complete mis-resolves stubs). Image rebuilds only on a Triton bump.
- [x] 2.3 Workflow `.github/workflows/triton-stub.yml` **drafted** (manual
      `workflow_dispatch`, `triton_version` input): free-disk-space → optional NGC
      login (gated on `NGC_API_KEY`) → GHCR login → `compose.py --backend python`
      from `r<ver>` server repo → push `ghcr.io/t03i/protifer-triton-stub:<ver>`.
      **UNVERIFIED** — compose.py flags + nvcr auth need a real run (§0.5).
- [ ] 2.1 **RUN the workflow** to actually compose + push the image. Confirm the
      composed size and that `compose.py`'s `--image full,/min,` flags are correct
      for the pinned tag. (Cannot run from a macOS dev session — infra-gated.)
- [x] 2.4 Document the bump ritual in the deploy runbook: prod Triton tag changes →
      bump `triton_version` here → re-run workflow. (No repo regen — derived at boot.)
      Documented in `infra/README.md` ("Triton stub bump ritual"); stale `mock-triton`
      reference there updated to `triton-stub`.

## 3. Wire dev & test stacks to the stub

- [x] 3.1 `infra/docker-compose.dev.yml`: replace the `mock-triton` build service
      with `triton-stub` (image `ghcr.io/t03i/protifer-triton-stub:25.06`, port
      `8001`). Mount `../model-repository:/src:ro` + `./triton-stub/entrypoint.py` +
      `./triton-stub/identity_model.py`; `command: ["python3", ".../entrypoint.py"]`.
      Keep `TRITON_URL=mock-triton:8001` via a service alias, or rename to
      `triton-stub` and update dependents (lean rename for honesty).
- [x] 3.2 `infra/docker-compose.test.yml`: same replacement + same mounts; keep `:8001`.
- [x] 3.3 Healthcheck → Triton's real `/v2/health/ready` (HTTP `:8000`) so compose
      `--wait` blocks on actual model readiness, not the mock's hand-rolled `/health`.
- [x] 3.4 Confirm the stub loads exactly the active set in
      `infra/triton/model-inventory.dev.json` (gateway inventory unchanged).

## 4. CI disk strategy (§ Decision 4)

- [ ] 4.1 In the integration job (`.github/workflows/ci.yml`, the
      `docker compose -f infra/docker-compose.test.yml … up --build --wait` step):
      bring the stub stack up and **measure peak disk**.
- [ ] 4.2 Primary: point Docker data-root at `/mnt`. Fallback: `jlumbroso/free-disk-space`.
      Pick the lighter one from 4.1; keep `--wait-timeout` generous for first pull.
- [x] 4.3 Confirm the GHCR pull authenticates via `GITHUB_TOKEN` (no nvcr in the PR job).
      Wired in `backend-e2e`: `permissions: packages:read` + `docker/login-action` to
      `ghcr.io` with `secrets.GITHUB_TOKEN`. Primary disk strategy (data-root → `/mnt`)
      and a peak-disk measurement step are in place; 4.1/4.2 await the first CI run to
      confirm the measurement and final mechanism pick.

## 5. ~~Freshness gate~~ — REMOVED (obviated by boot-time derivation)

- [x] 5.1 No freshness gate. The boot-time transform (§1) re-derives the stub repo
      from the real `model-repository/` every start, so there is no committed copy
      to drift and nothing to gate. The first cut's `check-triton-stub-fresh.ts` +
      `stub-freshness` CI job were removed along with the committed tree.

## 6. Prove it, then remove the mock (ordering matters)

- [x] 6.1 Local: `docker compose -f infra/docker-compose.dev.yml --profile … up`
      with the stub — all active models report READY; a real submission flows
      browser/worker → gateway → stub and returns zero-valued results of the
      **right shape/dtype**.
- [x] 6.2 **Audit fixture-value dependence** (risk #1): find consumers of
      `makePredictionOutputs` and any test asserting on mock output _values_
      (dssp3 strings, conservation, etc.). Move value-assertions to surface #1
      (fake `TritonClient`) or static fixtures. This gates removal.
      **Audit:** `makePredictionOutputs` + mock value-crafting are consumed ONLY by
      `infra/mock-triton/server.ts` and `mock-server.test.ts` (both deleted in 6.4/6.5)
      — zero external value-dependence. All crafted-value assertions (e.g. `dssp3 ===
'HECH'`) already live in surface-#1 adapter tests with hand-built responses
      (`adapters/*.test.ts`), untouched. The only stub-semantics-dependent E2E
      assertion was `pipeline.test.ts` `dssp3 toHaveLength(seqLen)` — against zero
      stubs the shape heuristic fills the `-1` dim with the 1024 feature dim, so it
      yielded 1024≠28. Relaxed to a structural non-empty-string check; exact
      per-residue length/content stays owned by `adapters/prott5_sec.test.ts`.
- [x] 6.3 Integration suite green against the stub in CI (`bun run test:int` path).
- [x] 6.4 Delete `infra/mock-triton/` (Dockerfile, package.json, server.ts).
- [x] 6.5 Delete `packages/triton-client/src/mock-server.ts` + its test; drop the
      `startMockTritonServer` export. Keep the fake-`TritonClient` unit double.
- [x] 6.6 Remove the now-dead `@protifer/mock-triton` workspace wiring (root
      `package.json` workspaces, turbo, any `bun` scripts).

## 7. Verify (gate before calling done)

- [x] 7.1 `bun run typecheck && bun run lint && bun run format && bun run test`.
- [x] 7.2 `bun run test:int` green against the stub (real Triton in the loop).
- [x] 7.3 Regression check: re-introduce the `b22f755` 1-D shape bug locally and
      confirm the **stub rejects it** where the mock accepted it — the proof this
      change does its job.
- [x] 7.4 `bun run build`.
- [ ] 7.5 PR; check CI ~5 min in; confirm the integration job fits the disk budget.

## Deferred (not this change)

- [ ] D.1 `_deferred/*` (esm2) models — wire into the stub if/when they go active.
- [ ] D.2 Shared compose fragment for the `triton-stub` service if dev/test drift.
- [ ] D.3 Option B (real onnxruntime backend + fabricated weights) — only if a
      future need demands leaf-level fidelity the wire contract doesn't.
