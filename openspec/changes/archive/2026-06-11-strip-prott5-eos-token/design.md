## Context

The `prot_t5_pipeline` ensemble (`model-repository/prot_t5_pipeline/config.pbtxt`)
has two steps: `_internal_prott5_tokenizer` (python) → `_internal_prott5_onnx`
(onnxruntime). The tokenizer calls `T5Tokenizer(...)` with the default
`add_special_tokens=True`, which appends a single `</s>` (EOS) token and adds no
leading/CLS token. The ONNX encoder therefore returns `last_hidden_state` of
shape `[L+1, 1024]`, and the ensemble maps that straight to its `embeddings`
output. The embedding worker stores the raw FP16 buffer; the prediction worker
derives `seqLen = bytes / (1024*2)`, so the leaked EOS row becomes a bogus extra
residue everywhere downstream.

Constraints:

- The model repository ships as an immutable, digest-pinned OCI artifact
  (`model-deployment` capability). Changing model files means rebuilding the
  artifact — acceptable here because no embeddings are computed yet (model-repo
  bring-up phase).
- `_internal_prott5_onnx` has `dynamic_batching` enabled; the ensemble runs each
  request at batch=1, but the fix must remain correct if Triton ever batches
  same-length requests.
- Embeddings are a user-facing product (bio_embeddings successor), so the stored
  artifact — not just predictions — must be clean.

## Goals / Non-Goals

**Goals:**

- Remove the trailing EOS row from `prot_t5_pipeline` output, per sequence.
- Keep EOS in the forward pass so residue embeddings match reference ProtT5.
- Keep the ensemble's external I/O contract unchanged.
- Fail loud if a mis-sized embedding ever reaches the worker.

**Non-Goals:**

- Changing tokenization (`add_special_tokens=False` is rejected — it alters the
  attention context and diverges every residue embedding from reference).
- Handling the deferred ESM-2 model (CLS + EOS). The helper is ProtT5-specific.
- Editing the ONNX graph to slice internally (brittle; the repo already uses
  python-backend models for this kind of glue).
- Cache invalidation (no embeddings exist yet).

## Decisions

### Decision: Insert a python post-process model, not `add_special_tokens=False`

A new `_internal_prott5_postprocess` python model sits between the ONNX encoder
and the ensemble output. It receives `last_hidden_state` + `attention_mask` and
returns `embeddings` with the EOS row dropped.

- **Why over `add_special_tokens=False`**: EOS must be attended during the
  forward pass — that is how ProtT5 was pretrained and how bio_embeddings
  extracts (run with EOS, slice `emb[:L]`). Removing EOS from the input changes
  every residue's embedding. Dropping only the output row preserves correctness.
- **Why over a prediction-worker-only fix**: the stored embedding is a product;
  it must be clean at the source, not patched per-consumer.
- **Why over editing the ONNX graph**: a python model is simpler, testable in
  isolation, and consistent with `_internal_prott5_tokenizer` /
  `_tmbed_viterbi`.

### Decision: Strip by `attention_mask`, not "drop last row"

The post-process logic is a pure helper `strip_eos(hidden, mask)`:
`lengths = mask.sum(axis=1) - 1`; allocate `zeros([B, max(lengths), 1024])`; copy
`hidden[b, :lengths[b]]` for each `b`. T5 uses right-padding, so real residues are
a contiguous prefix and EOS is the last attended token. This is correct for
batch=1 (reduces to `hidden[:, :L, :]`) and for any dynamically-batched,
right-padded input.

### Decision: Embedding-worker invariant guard as defense-in-depth

After fetching the FP16 buffer, the worker asserts
`fp16Buf.length / 2 / 1024 === sequence.length` and throws otherwise. Input
sequences are validated to standard residues upstream (UZOB→X is length-
preserving, one token per residue), so this invariant holds exactly. It catches
regressions (EOS reappearing, a leading token, tokenizer drift) loudly instead of
silently shipping wrong-length embeddings.

## Risks / Trade-offs

- **Implicit knowledge that T5 appends exactly one trailing token** → The
  post-process uses `attention_mask` (general) rather than a hardcoded offset,
  and the worker guard fails loud if the assumption ever breaks.
- **OCI artifact rebuild required** → Cost-free now (nothing deployed); folds
  into model-repo bring-up. New model must be added to the artifact packaging
  manifest alongside the inventory entry.
- **Re-pad path is only exercised under batching** → Unit-test `strip_eos` with a
  batch=2, differing-lengths case so the rarely-hit branch is covered.
- **Python test tooling** → The repo is Bun/TS-first; verify `strip_eos` with a
  small pytest run under the model's conda env, and rely on the real-Triton boot
  - backend E2E for end-to-end confirmation.

## Migration Plan

1. Add `_internal_prott5_postprocess/` (config + `model.py`) and rewire the
   ensemble.
2. Register the internal model in `model-inventory.dev.json` and the OCI artifact
   packaging; rebuild and re-pin `MODEL_ARTIFACT_REF`.
3. Add the worker guard + tests.
4. Verify via real-Triton boot (all models + ensemble READY) and backend E2E
   (stored bytes `== L*1024*2`; predictions have `L` positions).

Rollback: revert `MODEL_ARTIFACT_REF` to the prior digest and the code change;
no data migration since no embeddings are cached.

## Open Questions

- None blocking. The OCI packaging manifest location is determined during
  implementation from the `model-deployment` build tooling.
