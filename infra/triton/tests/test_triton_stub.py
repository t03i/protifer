"""
Tests for the dev/CI stub Triton runtime transform (infra/triton-stub/).

`entrypoint.py` derives a python-backed stub repo from the real model-repository/
at container boot; `identity_model.py` is the zeros stub injected into each leaf.
Both run without a Triton runtime here: the transform is pure stdlib, and the
identity model runs against a minimal `triton_python_backend_utils` stub (same
approach as test_tmbed_viterbi.py).
"""
import importlib.util
import json
import sys
import types
from pathlib import Path

import numpy as np
import pytest


def _repo_root() -> Path:
    for base in Path(__file__).resolve().parents:
        if (base / "model-repository").is_dir() and (base / "infra").is_dir():
            return base
    raise RuntimeError("could not locate repo root")


ROOT = _repo_root()
STUB_DIR = ROOT / "infra" / "triton-stub"


def _load_entrypoint():
    spec = importlib.util.spec_from_file_location(
        "triton_stub_entrypoint", STUB_DIR / "entrypoint.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ep = _load_entrypoint()


ONNX_LEAF = """name: "_x_onnx"
backend: "onnxruntime"
max_batch_size: 8
default_model_filename: "model.onnx"

input [ { name: "input_ids", data_type: TYPE_INT64, dims: [ -1 ] } ]
output [ { name: "last_hidden_state", data_type: TYPE_FP16, dims: [ -1, 1024 ] } ]
"""

PY_LEAF_WITH_CONDA = """name: "_x_tok"
backend: "python"
max_batch_size: 8

output [ { name: "input_ids", data_type: TYPE_INT64, dims: [ -1 ] } ]

# Shared CPU conda-pack env, sibling envs/ tree resolved relative to the model
# repository so the mount path can differ dev vs prod (Decision 8).
parameters: {
  key: "EXECUTION_ENV_PATH"
  value: { string_value: "$$TRITON_MODEL_DIRECTORY/../../envs/cpu_py312.tar.gz" }
}
"""

ENSEMBLE = """name: "x_pipeline"
platform: "ensemble"
max_batch_size: 8
output [ { name: "embeddings", data_type: TYPE_FP16, dims: [ -1, 1024 ] } ]
"""


class TestTransform:
    def test_classify(self):
        assert ep.classify(ENSEMBLE) == "ensemble"
        assert ep.classify(ONNX_LEAF) == "leaf"
        assert ep.classify(PY_LEAF_WITH_CONDA) == "leaf"

    def test_backend_rewritten_to_python(self):
        out = ep.transform_leaf(ONNX_LEAF)
        assert 'backend: "python"' in out
        assert "onnxruntime" not in out

    def test_contract_preserved(self):
        out = ep.transform_leaf(ONNX_LEAF)
        assert 'name: "last_hidden_state"' in out
        assert "data_type: TYPE_FP16" in out
        assert "dims: [ -1, 1024 ]" in out
        assert "max_batch_size: 8" in out

    def test_default_model_filename_stripped(self):
        assert "default_model_filename" not in ep.transform_leaf(ONNX_LEAF)

    def test_conda_block_and_comment_stripped(self):
        out = ep.transform_leaf(PY_LEAF_WITH_CONDA)
        assert "EXECUTION_ENV_PATH" not in out
        assert "parameters:" not in out
        assert "conda-pack" not in out
        assert 'name: "input_ids"' in out  # contract intact

    def test_idempotent(self):
        once = ep.transform_leaf(ONNX_LEAF)
        assert ep.transform_leaf(once) == once

    def test_strip_only_matching_block(self):
        text = (
            'parameters: {\n  key: "KEEP"\n  value: { string_value: "x" }\n}\n'
            'parameters: {\n  key: "EXECUTION_ENV_PATH"\n  value: { string_value: "y" }\n}\n'
        )
        out = ep.strip_parameters_blocks_containing(text, "EXECUTION_ENV_PATH")
        assert 'key: "KEEP"' in out
        assert "EXECUTION_ENV_PATH" not in out


class TestBuildRepoAgainstRealRepo:
    def test_derives_active_models(self, tmp_path):
        ensembles, leaves = ep.build_repo(
            ROOT / "model-repository", tmp_path / "models", STUB_DIR / "identity_model.py"
        )
        assert set(ensembles) == {"prot_t5_pipeline", "tmbed", "bind_embed"}
        assert len(leaves) == 19
        # ensembles verbatim, no model.py; leaves transformed, model.py injected
        ens = tmp_path / "models" / "prot_t5_pipeline"
        assert (
            ens / "config.pbtxt"
        ).read_text() == (
            ROOT / "model-repository" / "prot_t5_pipeline" / "config.pbtxt"
        ).read_text()
        assert not (ens / "1" / "model.py").exists()
        leaf = tmp_path / "models" / "_internal_prott5_onnx"
        assert 'backend: "python"' in (leaf / "config.pbtxt").read_text()
        assert (leaf / "1" / "model.py").exists()

    def test_deferred_skipped(self, tmp_path):
        ensembles, leaves = ep.build_repo(
            ROOT / "model-repository", tmp_path / "models", STUB_DIR / "identity_model.py"
        )
        assert not any(name.startswith("_deferred") for name in ensembles + leaves)
        assert not (tmp_path / "models" / "_deferred").exists()


# --- identity model, run against a stubbed triton_python_backend_utils ---


class _StubTensor:
    def __init__(self, name, arr):
        self._name, self._arr = name, np.asarray(arr)

    def name(self):
        return self._name

    def as_numpy(self):
        return self._arr


class _StubResponse:
    def __init__(self, output_tensors):
        self.output_tensors = output_tensors


def _install_pb_stub():
    pb = types.ModuleType("triton_python_backend_utils")
    pb.Tensor = _StubTensor
    pb.InferenceResponse = _StubResponse
    pb.get_input_tensor_by_name = lambda request, name: request.get(name)
    sys.modules["triton_python_backend_utils"] = pb


def _load_identity():
    _install_pb_stub()
    spec = importlib.util.spec_from_file_location(
        "stub_identity_model", STUB_DIR / "identity_model.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestIdentityModel:
    def _model(self, config):
        mod = _load_identity()
        m = mod.TritonPythonModel()
        m.initialize({"model_config": json.dumps(config)})
        return m

    def test_embeddings_shape_and_dtype(self):
        # prot_t5 onnx leaf: input_ids [-1] -> last_hidden_state FP16 [-1,1024]
        config = {
            "max_batch_size": 8,
            "input": [{"name": "input_ids", "data_type": "TYPE_INT64", "dims": ["-1"]}],
            "output": [
                {"name": "last_hidden_state", "data_type": "TYPE_FP16", "dims": ["-1", "1024"]}
            ],
        }
        m = self._model(config)
        # batch=2, seq_len=7
        req = {"input_ids": _StubTensor("input_ids", np.zeros((2, 7), dtype=np.int64))}
        [resp] = m.execute([req])
        out = resp.output_tensors[0]
        assert out.name() == "last_hidden_state"
        arr = out.as_numpy()
        assert arr.dtype == np.float16
        assert arr.shape == (2, 7, 1024)  # seq_len derived from input

    def test_string_output_is_bytes(self):
        config = {
            "max_batch_size": 16,
            "input": [{"name": "mask", "data_type": "TYPE_FP32", "dims": ["-1"]}],
            "output": [{"name": "labels", "data_type": "TYPE_STRING", "dims": ["1"]}],
        }
        m = self._model(config)
        req = {"mask": _StubTensor("mask", np.zeros((3, 5), dtype=np.float32))}
        [resp] = m.execute([req])
        arr = resp.output_tensors[0].as_numpy()
        assert arr.shape == (3, 1)
        assert arr.dtype == object

    def test_string_input_drives_dynamic_length(self):
        # tokenizer: sequences STRING [-1] -> input_ids INT64 [-1] sized by content
        config = {
            "max_batch_size": 8,
            "input": [{"name": "sequences", "data_type": "TYPE_STRING", "dims": ["-1"]}],
            "output": [{"name": "input_ids", "data_type": "TYPE_INT64", "dims": ["-1"]}],
        }
        m = self._model(config)
        seq = b"MKTAYIAKQR"  # length 10
        req = {"sequences": _StubTensor("sequences", np.array([[seq]], dtype=object))}
        [resp] = m.execute([req])
        arr = resp.output_tensors[0].as_numpy()
        assert arr.shape == (1, len(seq))
        assert arr.dtype == np.int64
