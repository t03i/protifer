# Deferred models (not downloaded, not served)

The model directories under this `_deferred/` subtree are **intentionally held
back** — they are NOT in the model manifest (`manifests/models.v1.json` in
`<deploy-org>/deploy-app`), so `init_models.py` never downloads them and
Triton never serves them. They are also absent from
`scripts/build-model-archives.py` `V14_FOLDERS`.

Currently deferred (FUT-09 — ESM2 re-enablement):

- `_internal_esm2_t33_onnx/`
- `_internal_esm2_t36_onnx/`
- `_internal_esm2_tokenizer/`
- `esm2_t33_pipeline/`
- `esm2_t36_pipeline/`

To re-enable a model: move its directory back up to `model-repository/`, add a
matching entry to `models.v1.json`, and add the folder to `V14_FOLDERS`.
