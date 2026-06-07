# Deferred models (not served)

The model directories under this `_deferred/` subtree are **intentionally held
back** — they are excluded from the locally-built OCI model artifact, so Triton
never serves them.

Currently deferred (FUT-09 — ESM2 re-enablement):

- `_internal_esm2_t33_onnx/`
- `_internal_esm2_t36_onnx/`
- `_internal_esm2_tokenizer/`
- `esm2_t33_pipeline/`
- `esm2_t36_pipeline/`

To re-enable a model: move its directory out of `_deferred/` back up to
`model-repository/` and rebuild the OCI artifact via
`scripts/build-model-artifact.py`.
