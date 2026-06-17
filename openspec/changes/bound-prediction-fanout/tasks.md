## 1. Config: concurrency + retry tunables

- [ ] 1.1 Add `maxInflightInfers` to `services/prediction-worker/src/config.ts` under `triton` via `configField()` (env `TRITON_MAX_INFLIGHT_INFERS`, env-wins, conservative positive-int default).
- [ ] 1.2 Add retry tunables (max attempts, base backoff ms) — either in `config.ts` (`triton`) or as documented `triton-client` defaults — read through typed config, not `process.env`.
- [ ] 1.3 Update `config.test.ts` to cover the new fields' defaults and override parsing.

## 2. Bound the fan-out with a shared semaphore

- [ ] 2.1 Add a minimal async semaphore utility (acquire returns a release handle; FIFO) — colocate in prediction-worker or `@protifer/shared` if reusable.
- [ ] 2.2 Construct one semaphore in `index.ts` sized by `config.triton.maxInflightInfers` and inject it into the processor/`dispatchAll` so it is process-wide (shared by all `WORKER_CONCURRENCY` jobs).
- [ ] 2.3 In `dispatch.ts`, acquire a permit around each `triton.modelInfer` call and release it in a `finally` (released on success, throw, and timeout alike).
- [ ] 2.4 Unit tests in `dispatch.test.ts`: (a) concurrent in-flight calls never exceed the limit across multiple simultaneous `dispatchAll` invocations; (b) a thrown `modelInfer` releases its permit (no leak); (c) excess calls wait rather than open immediately.

## 3. Transient transport retry in the client

- [ ] 3.1 In `packages/triton-client/src/client.ts`, wrap `modelInfer` with a bounded jittered retry firing only on the transient transport classes (`UNAVAILABLE`; transport-signature `INTERNAL` — bandwidth/parse/connection), never on `INVALID_ARGUMENT`/`NOT_FOUND`/`DEADLINE_EXCEEDED`.
- [ ] 3.2 Ensure the retry sits _inside_ the caller's held permit (retry loop in the client call, permit held by `dispatch.ts`) so retries do not widen concurrency.
- [ ] 3.3 Unit tests in `client.test.ts`: retries on transient classes up to the cap; no retry on deterministic/deadline classes; success-after-retry returns the response; exhausted retries surface the original classified error.

## 4. Channel keepalive

- [ ] 4.1 Add conservative `grpc.keepalive_time_ms` / `grpc.keepalive_timeout_ms` / `grpc.keepalive_permit_without_calls` options to the channel in `client.ts`, documented to avoid tripping Triton's server-side enforcement.
- [ ] 4.2 Confirm existing `client.test.ts` / `mock-server.test.ts` still pass with the new channel options.

## 5. Verification

- [ ] 5.1 Run repo gates: `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`.
- [ ] 5.2 Run `bun run test:int` (stack up) to exercise the bounded fan-out against the mock/real Triton path.
- [ ] 5.3 Load verification: on a real load run confirm no `Connection dropped` / `Bandwidth exhausted or memory limit exceeded` storm, the GPU is busy during prediction (not idle), prediction jobs complete, and BullMQ whole-job retries drop sharply.
- [ ] 5.4 Tune `TRITON_MAX_INFLIGHT_INFERS` upward until Triton is well-utilized without reintroducing transport errors; record the chosen value and rationale (deploy runbook).
