## Why

Under load the prediction worker self-DoSes Triton, producing the `All prediction models failed — … Connection dropped / Bandwidth exhausted or memory limit exceeded` storm while the GPU sits idle.

The cause is unbounded gRPC concurrency on a single connection. Each prediction worker creates **one** Triton client at boot (`index.ts:22`) — one shared HTTP/2 connection. Then `WORKER_CONCURRENCY = 4` jobs run in parallel, and each job's `dispatchAll` fires **all 8 adapters at once** via `Promise.allSettled` (`dispatch.ts:93`) with no concurrency limit. That is up to **32 simultaneous gRPC streams on one connection**, each shipping a full embedding (seqLen×1024 FP32 ≈ MBs). Several adapters are CV ensembles (`tmbed` → `_tmbed_cv0..4` + `_tmbed_viterbi`, `bind_embed` → `_bind_embed_cv0..4`), and every model is `instance_group { count: 1 }`, so those 32 streams expand to ~80 single-instance model executions contending at once.

The transport gives out before steady-state inference is reached: HTTP/2 flow-control windows and Triton's gRPC buffers overrun (`INTERNAL: Bandwidth exhausted or memory limit exceeded`), the saturated connection is reset (`UNAVAILABLE: Connection dropped`, `Failed parsing HTTP/2`), and because all 8 adapters share that one connection, a single reset fails the whole job (`outputs` empty → `processor.ts:78` throws). `grpc.enable_retries: 0` (`client.ts:127`) means one blip is terminal, and BullMQ whole-job retry re-runs the already-succeeded models and re-triggers the stampede.

This is client-induced, not Triton being down — which is why the GPU is idle while jobs fail. Shedding cannot mask it: shedding gates _embedding_ admission on residue backlog and has no model of prediction's fan-out concurrency, so the embedding worker (one `modelInfer` per job ≈ 4 streams) never trips while prediction melts down.

## What Changes

- **Bound the fan-out.** Introduce a worker-level concurrency limit on in-flight Triton `modelInfer` calls so a prediction worker holds at most a configured number of gRPC streams open at once, shared across all concurrent jobs (not per-job). The 8-adapter burst draws from this single permit pool instead of opening unconditionally.
- **Make the cap configurable.** A typed `configField()` tunable (env-wins) with a safe default derived from Triton's single-instance serving capacity; documented so it can be tuned on a load test without a code change.
- **Survive transient transport errors.** Add a bounded, jittered per-call retry on transient transport failures (`UNAVAILABLE` connection drops, transport-class `INTERNAL`) so a single RST does not fail the whole fan-out, and configure gRPC channel keepalive so an idle-then-bursty connection is not silently half-dead. No per-model _result_ retry semantics change; this is transport resilience only.

Out of scope (separate concerns / changes):

- The shedding `pending_residues` leak and wait/throughput estimation — `fix-shedding-residue-leak` (does not model prediction fan-out; independent).
- Worker latency metrics — `prediction-latency-observability` (would _confirm_ this storm via per-model time-to-failure; complementary, not required here).
- Moving prediction to a CPU/separate Triton — an isolation/topology decision (deploy-repo + `model-repository` instance-group tuning). It would isolate prediction from embedding's GPU memory but does **not** fix the single-connection stampede; orthogonal to this change.
- Restructuring partial-success so a whole-job retry skips already-succeeded models (caching per-model success across attempts) — follow-up; out of scope here.
- Load-testing methodology rework.

## Capabilities

### New Capabilities

- `prediction-dispatch`: The prediction worker's Triton fan-out is concurrency-bounded and resilient to transient transport faults — a configured ceiling on concurrent in-flight `modelInfer` streams per worker (shared across jobs), bounded jittered retry on transient transport errors, and keepalive-configured channels — so sustained load drives steady batched inference instead of saturating and resetting the shared HTTP/2 connection.

## Impact

- **Code**: `services/prediction-worker/src/dispatch.ts` (gate adapter calls behind a shared async semaphore; release on every path), `services/prediction-worker/src/config.ts` (concurrency-cap + retry tunables), `services/prediction-worker/src/index.ts` (construct/inject the semaphore so it is process-wide, shared by all jobs). `packages/triton-client/src/client.ts` (channel keepalive options; bounded transient-retry around `modelInfer`, reusing the existing `DEADLINE_EXCEEDED` mapping).
- **Config**: new env tunables for max in-flight infers per worker and retry attempts/backoff; defaults chosen for safety, documented for load-test tuning.
- **No API / schema change**; no user-facing change. Prediction throughput under load _increases_ (steady batched inference replaces failed stampedes), and the `All prediction models failed` storm is eliminated for transient transport causes.
- **Verification**: a real load run must show no `Connection dropped` / `Bandwidth exhausted` storm, non-idle GPU during prediction, and prediction jobs completing — currently only observable via logs until `prediction-latency-observability` lands.
