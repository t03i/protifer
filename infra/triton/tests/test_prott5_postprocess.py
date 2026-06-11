"""
Test strip_eos from model-repository/_internal_prott5_postprocess/1/model.py
directly (without Triton runtime). Validates that the ProtT5 EOS token row is
dropped per sequence and surviving residues are preserved as a zero-padded prefix.
"""
import sys
import types
from pathlib import Path

import numpy as np

# triton_python_backend_utils is only available in the Triton container; install a
# minimal stub so model.py imports.
_pb = types.ModuleType('triton_python_backend_utils')


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


_pb.Tensor = _StubTensor
_pb.InferenceResponse = _StubResponse
_pb.get_input_tensor_by_name = lambda request, name: request[name]
sys.modules['triton_python_backend_utils'] = _pb


def _find_model_dir() -> Path:
    for base in Path(__file__).resolve().parents:
        cand = base / 'model-repository' / '_internal_prott5_postprocess' / '1'
        if (cand / 'model.py').is_file():
            return cand
    raise RuntimeError('could not locate _internal_prott5_postprocess/1/model.py')


MODEL_DIR = _find_model_dir()
sys.path.insert(0, str(MODEL_DIR))

from model import TritonPythonModel, strip_eos  # noqa: E402

H = 1024


class TestStripEos:
    def test_batch1_drops_trailing_row(self):
        L = 5
        hidden = np.arange((L + 1) * H, dtype=np.float16).reshape(1, L + 1, H)
        mask = np.ones((1, L + 1), dtype=np.int64)
        out = strip_eos(hidden, mask)
        assert out.shape == (1, L, H)
        assert np.array_equal(out[0], hidden[0, :L])

    def test_batch2_differing_lengths_repad(self):
        # seq A: 3 residues + EOS; seq B: 5 residues + EOS, padded to T=6.
        T = 6
        hidden = np.random.randn(2, T, H).astype(np.float16)
        mask = np.zeros((2, T), dtype=np.int64)
        mask[0, :4] = 1  # 3 residues + EOS
        mask[1, :6] = 1  # 5 residues + EOS
        out = strip_eos(hidden, mask)
        assert out.shape == (2, 5, H)
        assert np.array_equal(out[0, :3], hidden[0, :3])
        assert np.array_equal(out[0, 3:], np.zeros((2, H), dtype=np.float16))
        assert np.array_equal(out[1, :5], hidden[1, :5])

    def test_preserves_dtype(self):
        hidden = np.ones((1, 3, H), dtype=np.float16)
        mask = np.ones((1, 3), dtype=np.int64)
        assert strip_eos(hidden, mask).dtype == np.float16


class TestExecute:
    def test_execute_emits_stripped_embeddings(self):
        L = 4
        hidden = np.random.randn(1, L + 1, H).astype(np.float16)
        mask = np.ones((1, L + 1), dtype=np.int64)
        model = TritonPythonModel()
        request = {
            'last_hidden_state': _StubTensor('last_hidden_state', hidden),
            'attention_mask': _StubTensor('attention_mask', mask),
        }
        resp = model.execute([request])[0]
        out = {t._name: t._arr for t in resp.output_tensors}
        assert out['embeddings'].shape == (1, L, H)
        assert np.array_equal(out['embeddings'][0], hidden[0, :L])
