## Why

The ProtT5 tokenizer appends a `</s>` (EOS) token to every sequence, so the
encoder emits `[L+1, 1024]` hidden states for an `L`-residue protein. That EOS
row currently leaks all the way through to storage and prediction: the stored
embedding carries a bogus trailing position, `seqLen` is reported one too high,
and every downstream classifier produces an extra junk residue prediction. The
classifiers were trained on EOS-stripped embeddings (the reference
bio_embeddings extraction), and the embedding itself is a user-facing product,
so the leaked token is simply wrong output. No embeddings are computed yet, so
fixing this now avoids a cache migration.

## What Changes

- Add a Python-backend post-process model to the `prot_t5_pipeline` ensemble that
  drops the trailing EOS row per sequence (keyed off `attention_mask`, so it
  stays correct under Triton dynamic batching). EOS remains present during the
  forward pass — only the output row is removed, matching how the classifiers
  were trained.
- Rewire the ensemble so the ONNX `last_hidden_state` flows through the
  post-process step before becoming the ensemble's `embeddings` output. The
  external contract (`sequences` → `embeddings [-1, 1024]`) is unchanged.
- Register the new internal model in the model inventory and include it when the
  OCI model artifact is repackaged.
- Add a defensive invariant guard in the embedding worker: the returned row
  count MUST equal the input sequence length, else fail loud.

## Capabilities

### New Capabilities

- `prott5-embedding`: The ProtT5 embedding pipeline output contract — per-residue
  embeddings that exclude special tokens, with a one-row-per-residue invariant
  enforced end-to-end.

### Modified Capabilities

<!-- None: model-deployment governs packaging/serving of the artifact, not the
     per-residue output contract. The new behavior is a distinct capability. -->

## Impact

- **Triton model repository**: new `model-repository/_internal_prott5_postprocess/`
  (config + `model.py`); rewired `model-repository/prot_t5_pipeline/config.pbtxt`.
- **Model inventory**: `infra/triton/model-inventory.dev.json` gains the internal
  post-process entry; OCI model artifact rebuilt and `MODEL_ARTIFACT_REF` re-pinned
  (part of model-repo bring-up — no deployed data to migrate).
- **embedding-worker**: `services/embedding-worker/src/processor.ts` gains the
  row-count invariant guard (+ test).
- **prediction-worker**: no behavioral change — it now receives correctly-sized
  `[L, 1024]` embeddings automatically.
- **Deferred ESM-2** (CLS + EOS) is out of scope; the helper is ProtT5-specific.
