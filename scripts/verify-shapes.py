#!/usr/bin/env python3
"""Verify bind_embed ONNX model has expected shape [batch, 1024, seq_len]."""
import sys
import onnx

models = [
    "model-repository/_bind_embed_cv0/1/model.onnx",
    "model-repository/_bind_embed_cv1/1/model.onnx",
    "model-repository/_bind_embed_cv2/1/model.onnx",
    "model-repository/_bind_embed_cv3/1/model.onnx",
    "model-repository/_bind_embed_cv4/1/model.onnx",
]

for path in models:
    m = onnx.load(path)
    shape = m.graph.input[0].type.tensor_type.shape
    dims = [d.dim_value for d in shape.dim]
    assert dims[1] == 1024, f"FAIL {path}: expected dims[1]=1024, got {dims}"
    print(f"OK {path}: dims={dims}")

print("All bind_embed shapes verified: [batch, 1024, seq_len]")
