# Design — Stub-backed real Triton for dev & integration tests

## The reframe

"Replace the mock with a real Triton" sounds like a swap of one container for
another. It isn't. The mock's failure mode is **epistemic**: it shares the
client's proto, so it can only ever confirm what the client already believes. The
goal is to insert, into dev and CI, the _one component that disagrees with the
client when the client is wrong_ — a real `tritonserver` that parses the real
`config.pbtxt` files and enforces field numbers, tensor ranks, and dtypes. Every
decision below is in service of that, at the smallest image and maintenance cost
that still keeps a real binary in the loop.

The crucial constraint the earlier exploration got _almost_ right and this design
corrects: it assumed "every leaf model is a python identity stub," so a
python-only image could reuse the real configs verbatim. The repo says otherwise —
most leaves are `backend: onnxruntime`:

```
  ensemble (core scheduler, no backend):  prot_t5_pipeline, tmbed, bind_embed
  backend: onnxruntime  (15 leaves):       _internal_prott5_onnx, _tmbed_cv0-4,
                                           _bind_embed_cv0-4, prott5_cons, prott5_sec,
                                           seth, vespag, light_attention_{membrane,subcell}
  backend: python  (2 active leaves):      _internal_prott5_tokenizer, _tmbed_viterbi
  _deferred/*:                             esm2 pipelines + onnx + tokenizer (not loaded)
```

So "reuse the real configs unchanged" would drag in the **onnxruntime backend and
real `.onnx` weight files** — a much bigger image and artifacts we don't have in
the repo. That fork (Decision 2) is the heart of this design.

## Decision 1 — A real `tritonserver` from `py3-min` + python backend, pushed to GHCR (SETTLED)

Build the stub image with NVIDIA's `compose.py`, not a hand-rolled Dockerfile:

```
  python3 compose.py \
    --backend python \
    --image min,nvcr.io/nvidia/tritonserver:25.06-py3-min \
    --output-name protifer-triton-stub:25.06
```

Verified facts behind this (spike, 2026-06-10):

- `25.06-py3-min` exists (amd64 + arm64), **manifest inspectable anonymously**.
- min is **backend-less**: NVIDIA compose docs — _"all contents in `/opt/tritonserver`
  of the min image will be removed … dependencies of the composed image are added
  properly."_ Backends are copied in **from the full `-py3` image** at compose
  time. So `compose.py` needs _both_ `-py3` and `-py3-min` available when it runs;
  its **output** is the slim image.
- Sizes (amd64 compressed): full `25.06-py3` = **11.32 GB**; `25.06-py3-min` =
  **6.08 GB**. The composed python-only stub ≈ **~6 GB** — about half the full
  image, but **not** "low single digit." This number drives Decision 4 (CI disk).

Why `compose.py` not `COPY`: the python backend has native deps (`libpython`,
boost, the `triton_python_backend_stub`); copying the directory alone fails at
load with missing `.so`s. `compose.py` is the supported one-command path and is
run **once per Triton-version bump**, not maintenance we own day-to-day.

Push to `ghcr.io/t03i/protifer-triton-stub:<triton-tag>` — same org as the OCI
model artifact and the `:sha` service images. CI pulls only the slim result.

## Decision 2 — Stub the leaves as python identity; keep the ensemble contract real (SETTLED)

This is the fork. Two ways to give a real Triton something to serve:

```
  Option A (CHOSEN) — python-identity leaves
    ensemble configs:  reproduced faithfully (external gRPC contract)
    leaf configs:      backend rewritten onnxruntime/python → python; I/O tensor
                       names, dtypes, dims preserved; model.py returns zeros
    image:             py3-min + python backend ONLY  (~6 GB)
    artifacts needed:  none (generated from the repo)

  Option B (REJECTED) — real backends, dummy weights
    leaf configs:      identical to prod (onnxruntime kept)
    image:             py3-min + python + onnxruntime backends  (heavier)
    artifacts needed:  a real-ish .onnx per onnx leaf (15 of them) with matching
                       I/O — weights we don't have in-repo and would have to fabricate
```

The bug we are defending against lives at the **ensemble boundary** — the external
input/output tensors of `prot_t5_pipeline` (`sequences: STRING [-1]` →
`embeddings: FP16 [-1,1024]`, `max_batch_size: 8`), `tmbed`, `bind_embed`. That is
what the gateway/worker call by name and what the proto/shape bugs violated.
Whether the _internal_ leaf that produces `last_hidden_state` is an ONNX runtime
or a python identity is invisible to the client. So Option A preserves exactly the
contract that matters while needing only the python backend and zero weight files.

Honest cost of A: the leaf `config.pbtxt` files **diverge from prod** (backend
field flips to `python`). That divergence is contained to internal models and is
ephemeral — it exists only in the boot-derived `/models`, never on disk (Decision
3). Option B's only advantage — byte-identical leaf configs — buys fidelity in a
layer the wire contract never touches, at the price of a bigger image and
fabricated ONNX artifacts. Rejected.

Identity stubs are **dependency-free beyond the python backend's bundled numpy**
(needed for `pb_utils.Tensor`). **No conda execution environment**: conda swaps a
model's _runtime_, not the backend; zero-dep stubs want the stock interpreter the
backend already ships. Adding conda would mean packing a tarball for nothing.

## Decision 3 — Derive the stub repo at container boot; never commit a copy (SETTLED)

The first cut of this generated a parallel `infra/triton-stub/model-repository/`
tree and committed it, guarded by a CI freshness gate. **That was wrong** — it
reintroduced the very thing this change exists to kill: a _second hand-maintained
copy of one contract_ (the original three were the proto, the mock's hardcoded
shapes, and `config.pbtxt`). A freshness gate only papers over duplication. So the
stub repo is **not committed at all**; it is derived at container boot from the one
source of truth, the real `model-repository/`:

```
  infra/triton-stub/entrypoint.py     reads  /src   (the real model-repository,
                                             mounted read-only)
                                      writes /models (tmpfs, derived each boot)
    ensemble (platform: ensemble)   → config.pbtxt used AS-IS (external contract)
    leaf (backend: onnxruntime|python)
                                    → backend rewritten to "python", conda
                                      EXECUTION_ENV_PATH block + default_model_filename
                                      stripped; input/output/dims/dtype preserved
                                    → infra/triton-stub/identity_model.py copied to 1/model.py
    _deferred/*                     → skipped (not in the active dev inventory)
  then: exec tritonserver --model-repository=/models --disable-auto-complete-config
```

Two files, both mounted (not baked) so the image stays generic: `entrypoint.py`
(the transform, pure stdlib) and `identity_model.py` (the zeros stub). Because the
transform runs every boot from `/src`, the stub _cannot_ drift from prod — there is
no copy to go stale and **no freshness gate to maintain**. Lockstep collapses to a
single axis: the real configs are read live; the image tag == prod Triton tag.

Why a transform at all (not pure symlinks): ensemble configs _are_ byte-identical
and could be symlinked, but the leaves must change `backend: onnxruntime → python`
and drop the conda block so a python-only Triton can serve them without the onnx
backend or weights. That delta can't be a symlink, so a boot-time transform handles
both uniformly from the single source. The leaf-config divergence lives only in the
ephemeral `/models`, never on disk.

### One canonical identity model, config-driven (SETTLED)

`identity_model.py` is dropped into every leaf's `1/model.py` unchanged. It reads
its own `model_config` in `initialize()` and emits zeros for each declared output —
no per-model code generation, one file to reason about and fix.

**Shape derivation is a documented best-effort heuristic, not exact.** A leaf
output's `-1` dim is filled from: the decoded _content length_ for STRING inputs
(so the tokenizer→onnx→`embeddings` path tracks the submitted sequence length),
else the **largest non-batch input dimension**, else a constant 16. Exact for the
common per-residue paths, deliberately approximate where the input→output dynamic-
dim mapping is non-obvious — e.g. `_bind_embed_cv0` declares input `[1024, -1]` and
output `[-1, 3]`; the heuristic fills the output `-1` with 1024, not the true
residue count. **Safe**: Triton enforces only _fixed_ output dims exactly (the `3`,
the `1024` on `embeddings`); a `-1` dim accepts any non-negative length. The wire
contract (dtype + fixed dims + tensor names) is what we defend, and it holds.
Recorded as a known limitation, not a bug.

The transform (`classify`/`transform_leaf`/`build_repo`) and the identity model
(against a stubbed `pb_utils`, like `test_tmbed_viterbi.py`) are unit-tested in
`infra/triton/tests/test_triton_stub.py` — picked up by the existing
`pytest infra/triton/tests/` CI job. Full READY-state verification is boot-based
(task 6.1).

## Decision 4 — CI disk strategy for a ~6 GB image (SETTLED, with a measured fallback)

A GitHub-hosted `ubuntu-latest` runner gives ~14 GB free on `/` (Docker's
graph root) and a larger ephemeral disk at `/mnt` (~65 GB). A ~6 GB compressed
image unpacks to well past 14 GB once layered with the existing test stack
(postgres, redis, garage, three service builds). Two supported options:

```
  Primary   point Docker data-root at /mnt before the stack comes up
            (configure dockerd data-root / restart, or DOCKER_* + /mnt mount)
  Fallback  jlumbroso/free-disk-space@main  (reclaims ~30 GB of preinstalled
            toolchains) if data-root relocation fights the runner image
```

Both are well-trodden. Primary is preferred (no ~30 GB reclaim step per run).
Decide empirically in the build-out: bring the stub stack up on a runner, measure
peak disk, pick the lighter mechanism.

## Decision 5 — `nvcr.io` auth: confirmed for manifest, unconfirmed for layer pull (OPEN — small spike)

The manifest of `25.06-py3-min` inspected **anonymously**. Whether pulling the
**layers** (during `compose.py`, which happens on a build host, not in the
integration job) needs a free NGC login is unconfirmed. Two reasons it's low-risk:

- `compose.py` runs in a **dedicated build/push workflow**, not the per-PR
  integration job. If NGC auth is needed, it's one `docker login nvcr.io` with an
  `NGC_API_KEY` secret scoped to that one workflow — the PR job only pulls the
  composed image from **GHCR** (already authed via `GITHUB_TOKEN`).
- It does not block the design; it's a secret-wiring detail for one job.

Spike task: attempt an anonymous layer pull of `-py3-min`; if it 401s, wire
`NGC_API_KEY` into the compose/push workflow only.

## Decision 6 — Wiring keeps `TRITON_URL` and the gateway inventory unchanged (SETTLED)

**Nothing baked, nothing copied (SETTLED).** The GHCR image carries only
`tritonserver` + the python backend. The compose stacks bind-mount three things:
`../model-repository:/src:ro` (the single source), and the two `infra/triton-stub/`
python files; `entrypoint.py` is the command — it derives `/models` from `/src` at
boot then execs tritonserver (Decision 3). The image rebuilds **only on a Triton
version bump**; a contract change needs nothing here (the next boot re-derives).
This mirrors how the real `cpu-triton` mounts `/data/models` rather than baking
weights. Lockstep is a single axis: the image tag == prod Triton tag — the configs
themselves are read live from the real repo, so there is no repo-copy to keep in
sync.

Both `infra/docker-compose.dev.yml` and `infra/docker-compose.test.yml` define a
`mock-triton` build service on `:8001` with `TRITON_URL=mock-triton:8001`. The new
`triton-stub` service uses the GHCR image, keeps `:8001`, and the dependents
(`api-gateway`, workers) keep `TRITON_URL` — ideally renamed to `triton-stub` for
honesty, but a service alias avoids churn if preferred. The gateway still reads
`infra/triton/model-inventory.dev.json`, and the stub loads exactly that active
set. The stub inherits the `cpu-triton` lesson: launch with
`--disable-auto-complete-config` (strict configs; auto-complete mis-resolves
stubs) — the same flag the real CPU profile proved out (22/22 READY).

Healthcheck: the mock exposed an HTTP `/health`; the stub uses Triton's real
`/v2/health/ready` (HTTP `:8000`) so compose `--wait` blocks on genuine model
readiness, not a hand-rolled 200.

## Risks

- **Fixture-value tests break.** The mock returned crafted outputs (dssp3 strings,
  conservation scores); the stub returns zeros. Any test asserting on those values
  fails. Mitigation: audit consumers of `makePredictionOutputs`/fixture values
  before the cutover; move value-assertions to surface #1 (fake `TritonClient`)
  or to static fixtures. **This audit gates the mock's removal**, not the stub's
  arrival.
- **Shape-derivation bugs in the identity model.** If the stub emits the wrong
  rank/dtype, the _ensemble_ won't load and the whole stack fails to come up —
  loud, not silent, which is the right failure direction. Mitigation: the unit
  tests in `test_triton_stub.py` plus a boot smoke test that all active models
  report READY (the real bar, like `cpu-triton`).
- **Stub diverges from prod contract.** Structurally impossible: the repo is
  re-derived from the real `model-repository/` on every boot (Decision 3), so there
  is no stored copy to drift. The image tag == prod Triton tag closes the image
  axis. This is what makes the stub _better_ than the mock rather than a
  differently-shaped lie.
- **Image size creep on Triton bumps.** A future `-py3-min` could grow. Mitigation:
  the compose/push workflow logs the composed size; Decision 4's data-root choice
  has headroom to ~65 GB.
- **NGC auth surprise (Decision 5).** Contained to the build/push workflow; the
  PR-path integration job only touches GHCR.
- **Two compose files drift.** dev and test both define the service. Mitigation:
  keep the `triton-stub` service definition identical across both; consider a
  shared fragment if churn appears.
