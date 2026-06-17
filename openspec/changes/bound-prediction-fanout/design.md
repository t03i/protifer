## Context

Each prediction worker holds a single `TritonClient` created at boot (`index.ts:22`), which is a single gRPC/HTTP-2 connection. `processPredictionJob` reads the embedding from S3 and calls `dispatchAll` (`dispatch.ts:86`), which fires every adapter in `ADAPTER_REGISTRY` (8 entries) concurrently via `Promise.allSettled` with no concurrency control. BullMQ runs `WORKER_CONCURRENCY = 4` jobs per worker in parallel, so a worker opens up to 32 concurrent `modelInfer` streams on that one connection. Because `tmbed` and `bind_embed` are CV ensembles and every model is `instance_group { count: 1 }`, those streams expand to ~80 single-instance model executions queued at Triton at once.

The transport, not the GPU, is the bottleneck: HTTP/2 flow control and Triton's gRPC buffers saturate, the connection resets, and every adapter sharing the connection fails together — surfaced as `All prediction models failed — …(INTERNAL): Bandwidth exhausted or memory limit exceeded` and `…(UNAVAILABLE): Connection dropped | Failed parsing HTTP/2`. `grpc.enable_retries: 0` makes a single reset terminal; `dispatch.ts` has no retry; `processor.ts:78` throws when `outputs` is empty, and BullMQ re-runs the whole job (including the models that _did_ succeed), re-triggering the stampede.

The fix is to make the worker offer Triton a steady, bounded stream of requests instead of a burst — which is also what Triton's dynamic batching (enabled on most models) is designed to consume.

## Goals / Non-Goals

**Goals:**

- Cap the number of concurrent in-flight `modelInfer` streams per worker, shared across all concurrent jobs, so the shared connection is never asked to carry more than it can serve.
- Keep job-level parallelism (`WORKER_CONCURRENCY`) intact — bound the fan-out, not the throughput knob.
- Make the cap a typed, documented tunable so it can be matched to Triton's serving capacity on a load test without code changes.
- Survive transient transport faults (connection drops) with bounded, jittered retry so one RST does not fail an otherwise-healthy fan-out.
- Configure channel keepalive so a long-lived connection is not silently half-open under bursty load.
- Eliminate the `All prediction models failed` storm for transient transport causes and keep the GPU usefully busy under load.

**Non-Goals:**

- Changing `WORKER_CONCURRENCY`, the queue rate limit, or BullMQ retry/backoff defaults.
- Triton-side tuning (`instance_group` counts, dynamic-batching windows, gRPC server limits) — a `model-repository` / deploy concern.
- Moving prediction to a CPU or a separate Triton instance — an isolation/topology decision, orthogonal to the single-connection stampede this change fixes.
- Caching per-model success across whole-job retries (so a retry skips succeeded models) — a follow-up to the partial-success contract.
- Worker latency metrics (`prediction-latency-observability`) — complementary, not required here.

## Decisions

### Decision 1: Bound with a process-wide async semaphore over `modelInfer`, not by lowering `WORKER_CONCURRENCY`

Introduce one async semaphore per worker process, sized by config, and acquire a permit immediately around each `triton.modelInfer` call inside the `dispatchAll` fan-out. Because the semaphore is module/process-scoped and injected, all `WORKER_CONCURRENCY` jobs draw from the _same_ permit pool, so the worker-wide in-flight stream count is bounded regardless of how many jobs are mid-fan-out.

- Acquire as tightly as possible around the gRPC call (after `buildRequest`, released before/around `decodeResponse` is acceptable since decode is CPU-local); release in a `finally` so an error or timeout never leaks a permit.
- **Alternative — lower `WORKER_CONCURRENCY`:** rejected. It throttles whole-job throughput and starves the queue, yet a single job still bursts 8 (≈20 ensemble) streams at once, so the connection can still saturate. The knob is the wrong grain.
- **Alternative — per-job `p-limit`:** rejected. A per-job limit of N still allows `WORKER_CONCURRENCY × N` worker-wide, which is exactly the cross-job stampede. The bound must be shared across jobs.
- **Alternative — push the limit to Triton (server-side rate limiter / queue):** rejected as the primary lever. The monorepo does not own Triton tuning cleanly, and the burst still hits the client connection first; client-side backpressure is where the over-issue originates.

### Decision 2: Cap value is a typed tunable with a capacity-derived default

Add a `configField()` (env-wins, 12-factor tunable) such as `TRITON_MAX_INFLIGHT_INFERS` read into `config.triton`. Default to a small number with headroom over the single-instance models — chosen so steady dynamic-batching is fed without re-saturating the connection — and document that it is tuned against observed Triton capacity on a load run.

- The default is intentionally conservative: under-utilizing Triton is recoverable by raising the cap; over-issuing reproduces the storm. Start safe, tune up.
- App code reads `config.triton.maxInflightInfers`, never `process.env` (per the config convention).

### Decision 3: Bounded jittered retry on transient transport errors, at the client call site

Wrap `modelInfer` (in `triton-client`) with a small, bounded retry (e.g. ≤2 extra attempts, exponential + jitter) that fires only on transient transport classes — `UNAVAILABLE` (connection dropped) and transport-level `INTERNAL` (bandwidth/parse) — and never on `INVALID_ARGUMENT`, `NOT_FOUND`, or `DEADLINE_EXCEEDED` (already mapped to `TritonTimeoutError`). The retry holds its semaphore permit across attempts so retries cannot themselves widen concurrency.

- Keep this in `triton-client` so both workers benefit and the classification lives next to the existing gRPC error handling; expose attempts/backoff via config with a safe default.
- **Alternative — gRPC built-in retries (`grpc.enable_retries` + service config):** rejected as primary. grpc-js retry/service-config is finicky to get right and opaque to tune; an explicit app-level retry on a closed transient-class set is clearer and testable. (Channel-level retry can be revisited later.)
- **Alternative — rely on BullMQ whole-job retry only:** rejected. It re-runs succeeded models and re-bursts the fan-out; per-call retry resolves transients without re-stampeding.

### Decision 4: Channel keepalive on the Triton client

Add gRPC keepalive options to the channel (`grpc.keepalive_time_ms`, `grpc.keepalive_timeout_ms`, `grpc.keepalive_permit_without_calls`) so a connection that goes idle between bursts is kept healthy and a half-dead connection is detected promptly rather than surfacing as a mid-call `Failed parsing HTTP/2`.

- Values chosen conservatively to avoid tripping Triton's server-side keepalive enforcement (too-frequent pings → `ENHANCE_YOUR_CALM`); document alongside the cap.

## Risks / Trade-offs

- **Cap too low → Triton under-utilized.** Mitigated by making it a documented tunable and starting conservative; raise on the load test until GPU is saturated without storms.
- **Cap too high → storm returns.** Same mitigation; the default leaves headroom and the verification step explicitly watches for `Connection dropped` / `Bandwidth exhausted`.
- **Permit leak / deadlock.** A permit not released on an error path would slowly throttle the worker to zero. Mitigated by `finally`-release and a unit test that asserts the permit count is restored after a thrown `modelInfer`.
- **Retry amplifies load.** Bounded attempts, jittered backoff, and holding the permit across retries keep retried calls inside the concurrency bound; the closed transient-class set prevents retrying deterministic failures.
- **Keepalive too aggressive.** Over-frequent pings can themselves draw `ENHANCE_YOUR_CALM`; values are conservative and documented.
- **Latency under contention.** Bounding concurrency adds queueing delay per call under load — but the alternative today is failure, and steady batched inference has higher effective throughput than a stampede that resets.

## Migration Plan

1. Land the semaphore + config tunables, the bounded transient retry, and channel keepalive behind safe defaults (no behavioral change at low load).
2. On a real load run, confirm: no `Connection dropped` / `Bandwidth exhausted or memory limit exceeded` storm; GPU is busy during prediction (not idle); prediction jobs complete; whole-job retries drop sharply.
3. Tune `TRITON_MAX_INFLIGHT_INFERS` up until Triton is well-utilized without reintroducing transport errors; record the chosen value and rationale.
4. (Independent) `prediction-latency-observability` makes step 2 measurable via per-model time-to-failure instead of log-watching.

Rollback: set the cap high enough to be a no-op (or revert) and disable the transient retry — behavior returns to today's unbounded fan-out, no worse than current.

## Open Questions

- **Single channel + semaphore vs. a small channel pool.** Start with one connection bounded by the semaphore. If a single HTTP/2 connection's `MAX_CONCURRENT_STREAMS` (not raw saturation) turns out to be the binding limit even at a sane cap, a small channel pool in `triton-client` is the next lever. Default: one channel; revisit on the load test.
- **Exact default cap and keepalive values** — to be set from observed Triton capacity during verification; the schema ships conservative defaults.
- **Whether transport-class `INTERNAL` is reliably distinguishable from a genuine server `INTERNAL`.** Retry only on the transport-signature variants (bandwidth/parse/connection); if ambiguous, prefer not retrying (fail fast) and lean on the concurrency bound to prevent them arising.
