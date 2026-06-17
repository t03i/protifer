## 1. Submission counter (independent — can land first)

- [ ] 1.1 Add a `submissions_total{route,plan}` counter to `services/api-gateway/src/metrics.ts` (low-cardinality labels only).
- [ ] 1.2 Increment it on the `POST /v1/predictions` and `POST /v1/embeddings` submission path, next to the existing `msg:"submission"` log line; read the plan from the authenticated context.
- [ ] 1.3 Confirm it appears on `/metrics` and document it in the metrics catalog (`infra/monitoring/README.md` pointer / deploy-app runbook handoff).

## 2. Admission guard (independent — can land first)

- [ ] 2.1 Add `tests/load/admission.js` merging the free-plan 429 assertion from `rate-limiter.js` with a cached pro-plan submit assertion (no 5xx, correct rate-limit headers), both against a cached accession so no real inference runs.
- [ ] 2.2 Header documents explicitly that this covers the rate-limit contract only, NOT shedding (503 lives in `saturate.js`).
- [ ] 2.3 Keep the `K6_SMOKE` credential guard and the free/pro bearer env contract.
- [ ] 2.4 Delete `tests/load/rate-limiter.js` once `admission.js` subsumes it.

## 3. Retire throughput.js

- [ ] 3.1 Delete `tests/load/throughput.js`.
- [ ] 3.2 Remove its step from `.github/workflows/nightly.yml`.

## 4. CI cadence wiring

- [ ] 4.1 In `.github/workflows/nightly.yml`, run `admission.js` on the cron (replacing rate-limiter + throughput steps).
- [ ] 4.2 Keep `pipeline` and `saturate` as `workflow_dispatch` toggles with no schedule; update input descriptions to state cost (real GPU + permanent prod S3) and cadence (frequent vs rare).

## 5. Finalize pipeline.js (after prediction-latency-observability + fix-shedding-residue-leak)

- [ ] 5.1 Remove the concurrent-cap 429 back-off path; size VUs ≤ the pro concurrent-job cap (read from env, conservative default; source the cap from `packages/shared/src/plan.ts`).
- [ ] 5.2 Treat an unexpected cap-429 as a failed check ("run mis-sized — lower VUs"), not a tolerated outcome.
- [ ] 5.3 Trim in-script measurement to client-perceived `e2e_latency` + `submit_latency`; document that per-model latency / drain are read from `/metrics` (`triton_model_infer_duration_seconds`, `shedding_residues_per_second`, queue depth).
- [ ] 5.4 Header documents this doubles as the `bound-prediction-fanout` tuning harness.

## 6. Replace shedding.js with saturate.js (after fix-shedding-residue-leak)

- [ ] 6.1 Rename/replace `tests/load/shedding.js` → `tests/load/saturate.js`; keep over-cap ramp + 503 tolerance + mixed lengths.
- [ ] 6.2 Update the calibration note to read the now-trustworthy `shedding_residues_per_second` aggregate drain rate.
- [ ] 6.3 Header documents this is the ONLY 503/shedding coverage and is run on demand only (rare tier).

## 7. Verification

- [ ] 7.1 `K6_SMOKE=true` syntax-validate every script (`admission.js`, `pipeline.js`, `saturate.js`).
- [ ] 7.2 Run `admission.js` against prod: free-plan 429 fires with header, pro cached submits non-5xx, no real inference triggered.
- [ ] 7.3 Run `pipeline.js` under the cap: jobs reach terminal state, no cap-429, and confirm `submissions_total` ≈ bullmq enqueued ≈ completed (accounting gap closed/visible).
- [ ] 7.4 Run `saturate.js`: 503s tolerated, `shedding_residues_per_second` readable at steady state.
- [ ] 7.5 Repo gates: `bun run lint` (k6 scripts are `.js`, eslint-only), `bun run typecheck`/`test` for the gateway counter change.
