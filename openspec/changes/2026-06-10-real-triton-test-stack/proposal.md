# Stub-backed real Triton for dev & integration tests

## Why

Two Triton bugs shipped in two days and both had the **same root cause**: the
mock Triton server lies about the wire protocol.

- `95fdc7c` — wrong proto **field numbers** in `grpc_service.proto`.
- `b22f755` — the worker sent **1-D** `sequences` where Triton requires a **2-D
  `[1, 1]`** batched tensor (PR #15, `fix(embedding): unblock real-Triton
inference`).

Both passed every check we have. The reason is structural: `infra/mock-triton`
runs a Bun gRPC server that loads **the same `packages/triton-client/proto/grpc_service.proto`
the client loads** (`startMockTritonServer` → `getPackageDef()`), so client and
mock agree by construction. A malformed request the client builds is decoded by
the mock with the identical (possibly wrong) schema and answered happily. Dev and
the integration suite go green; the first time a request reaches a **real**
`tritonserver` — which enforces field numbers, tensor ranks, dtypes, and
`config.pbtxt` contracts — it breaks. The mock doesn't just fail to catch these
bugs; it **manufactures confidence** that they aren't there.

There are three distinct "Triton" surfaces today, and only one is the problem:

```
  1  worker/gateway UNIT tests   → NOT Triton. A fake TritonClient JS object;
                                    InferResponse hand-built via fp32ArrayToFp16Buffer.
                                    Pure JS, no server, no Docker.        KEEP, out of scope.
  2  mock-triton gRPC server      → infra/mock-triton/server.ts +
                                    packages/triton-client/src/mock-server.ts (566 lines).
                                    Sole consumer: the docker dev/test stack
                                    (compose service `mock-triton`, TRITON_URL=mock-triton:8001).
                                    Lies about the protocol.              ◄── REPLACE.
  3  real Triton                  → `cpu-triton` compose profile + prod
                                    (nvcr.io/nvidia/tritonserver:25.06-py3, OCI model artifact).
                                    The thing we're trying to match.      KEEP.
```

Surface #2 is the only consumer of the gRPC mock. Replacing it with a _real_
`tritonserver` — same binary, same gRPC stack, same `config.pbtxt` parser as prod
— costs nothing in the inner loop (unit tests never touched it) and nothing extra
in integration (the suite already runs `docker compose … up --build --wait`,
`infra/docker-compose.test.yml`). Whatever a real Triton would reject in prod,
the stack now rejects in CI.

The catch the earlier exploration flagged — _"Triton is huge"_ — is real but
bounded. The full `25.06-py3` image is **11.32 GB** compressed; it does not fit a
GitHub-hosted runner's ~14 GB-free `/`. The escape is the minimal base
`25.06-py3-min` (**6.08 GB** compressed, verified) plus **only the backend we
actually need**, pushed to GHCR and pulled in CI. That image is ~half the full
one and is real `tritonserver`, not a reimplementation.

## What Changes

- **A new stub Triton image** built from `nvcr.io/nvidia/tritonserver:25.06-py3-min`
  via NVIDIA's supported `compose.py` (min is backend-less; backends are copied in
  from the full image — verified against NVIDIA's compose docs). It carries the
  **python backend only — no model-repository baked in.** Pushed to
  `ghcr.io/t03i/protifer-triton-stub:25.06` (same GHCR org as the OCI model
  artifact). **Base tag pinned == prod Triton tag** so a prod bump forces a stub
  bump and the proto/shape contract stays in lockstep — that lockstep is the
  entire point.

- **No second copy of the model-repository — the stub repo is derived at boot.**
  The real `model-repository/` is the single source of truth; nothing is
  replicated into the tree. The stub container mounts it read-only and a small
  python `entrypoint.py` (`infra/triton-stub/`) derives a python-backed repo at
  startup: ensemble configs (`prot_t5_pipeline`, `tmbed`, `bind_embed`, …) — the
  external gRPC contract the client hits — are used **as-is**; leaf configs (today
  `backend: onnxruntime` for most, `python` for three) get their backend rewritten
  to `python`, the conda `EXECUTION_ENV_PATH` block stripped, and a **dependency-
  free identity model** (`identity_model.py`, returns correctly-shaped/typed zeros)
  dropped in. No conda env — the stock interpreter the python backend ships is
  enough. Because the repo is regenerated every boot, it can never drift from the
  real one — no committed copy, no freshness gate.

- **The dev and test stacks point at the stub instead of `mock-triton`.** Replace
  the `mock-triton` service in `infra/docker-compose.dev.yml` and
  `infra/docker-compose.test.yml` with a `triton-stub` service running the new
  image, **mounting `../model-repository:/src:ro`** plus the two `infra/triton-stub/`
  python files, with `entrypoint.py` as the command (still `:8001`, so `TRITON_URL`
  is unchanged). The integration suite (`.github/workflows/ci.yml`) then exercises
  a real Triton on every PR.

- **CI image/disk wiring.** A workflow to compose+push the stub image to GHCR
  (manual / on Triton-version bump), and a disk strategy for the integration job
  so a ~6 GB image fits (Docker data-root on `/mnt` or `jlumbroso/free-disk-space`).

- **Removal of the dead mock** once the real-Triton path is green:
  `infra/mock-triton/` and `packages/triton-client/src/mock-server.ts` (+ its
  test). The fake-`TritonClient` unit-test double (surface #1) is untouched.

## Non-goals

- **Surface #1 is not touched.** Worker/gateway unit tests keep injecting a fake
  `TritonClient`; they are fast, hermetic, and never spoke the protocol.
- **No real weights, no GPU, no inference fidelity.** The stub returns zeros. It
  validates the _protocol and shape contract_, not numerical output. Tests that
  assert on fixture _values_ must move to fixtures or to surface #1 (see design).
- **Prod Triton and the OCI model deployment are unchanged.** The stub reuses the
  `cpu-triton` learnings (`--disable-auto-complete-config`) but derives its repo at
  boot from the checked-in `model-repository/` rather than pulling the OCI artifact.
- **The `_deferred/` models stay deferred.** The stub loads the same active set
  the dev gateway expects (`infra/triton/model-inventory.dev.json`).
