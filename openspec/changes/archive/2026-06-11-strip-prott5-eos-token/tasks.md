## 1. Post-process Triton model

- [x] 1.1 Create `model-repository/_internal_prott5_postprocess/1/model.py` with a pure `strip_eos(hidden, mask)` helper (`lengths = mask.sum(axis=1) - 1`; zero-padded copy of `hidden[b, :lengths[b]]`) and a `TritonPythonModel` that reads `last_hidden_state` (FP16) + `attention_mask` (INT64) and outputs `embeddings` (FP16)
- [x] 1.2 Create `model-repository/_internal_prott5_postprocess/config.pbtxt` (python backend, `max_batch_size: 8`, inputs `last_hidden_state` FP16 `[-1,1024]` + `attention_mask` INT64 `[-1]`, output `embeddings` FP16 `[-1,1024]`, same `EXECUTION_ENV_PATH` conda env as `_internal_prott5_tokenizer`)

## 2. Ensemble rewiring

- [x] 2.1 Edit `model-repository/prot_t5_pipeline/config.pbtxt`: map ONNX `last_hidden_state` to an internal value (e.g. `_last_hidden_state`) instead of `embeddings`
- [x] 2.2 Add the `_internal_prott5_postprocess` step consuming `_last_hidden_state` + `attention_mask`, mapping its `embeddings` output to the ensemble's `embeddings` output (external contract unchanged)

## 3. Inventory & artifact packaging

- [x] 3.1 Add `{ "triton": "_internal_prott5_postprocess", "role": "internal", "version": "dev" }` to `infra/triton/model-inventory.dev.json`
- [x] 3.2 Confirm `scripts/build-model-artifact.py` and `scripts/check-model-repository-layout.py` pick up the new model dir (run them; fix manifest/layout enumeration if the model is not included)

## 4. Embedding-worker invariant guard

- [x] 4.1 In `services/embedding-worker/src/processor.ts`, after obtaining `fp16Buf`, assert `fp16Buf.length / 2 / 1024 === sequence.length` and throw a descriptive error on mismatch
- [x] 4.2 Add cases to `services/embedding-worker/src/processor.test.ts`: guard passes at exact row count, throws at `L+1` rows

## 5. Tests & verification

- [x] 5.1 Add `infra/triton/tests/test_prott5_postprocess.py` (mirroring `test_tmbed_viterbi.py`) covering `strip_eos`: batch=1 drops trailing row; batch=2 with differing lengths drops each EOS and re-pads with zeros
- [x] 5.2 Boot real Triton against the model repository; confirm `_internal_prott5_postprocess` and `prot_t5_pipeline` both report READY
- [x] 5.3 Backend E2E: embed a known `L`-residue sequence → stored embedding byte length `== L * 1024 * 2`; run a prediction → per-residue outputs have exactly `L` positions
- [x] 5.4 Run repo quality gates: `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`
