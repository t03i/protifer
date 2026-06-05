"""
Test the Viterbi Decoder class from model-repository/_tmbed_viterbi/1/model.py
directly (without Triton runtime). Validates that the verbatim port of upstream
tmbed/viterbi.py decodes synthetic emissions into valid F4 alphabet tag indices.
"""
import sys
import types
from pathlib import Path

import numpy as np
import pytest
import torch
import torch.nn.functional as F

# triton_python_backend_utils is only available in the Triton container; install a
# minimal functional stub so model.py imports AND its execute() wrapper runs.
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


def _get_input_tensor_by_name(request, name):
    return request[name]


_pb.Tensor = _StubTensor
_pb.InferenceResponse = _StubResponse
_pb.get_input_tensor_by_name = _get_input_tensor_by_name
sys.modules['triton_python_backend_utils'] = _pb


def _find_model_dir() -> Path:
    """Walk up from this file to locate model-repository/_tmbed_viterbi/1 — robust
    to model-repository sitting at the repo root (local) or elsewhere (container)."""
    for base in Path(__file__).resolve().parents:
        cand = base / 'model-repository' / '_tmbed_viterbi' / '1'
        if (cand / 'model.py').is_file():
            return cand
    raise RuntimeError('could not locate model-repository/_tmbed_viterbi/1/model.py')


MODEL_DIR = _find_model_dir()
sys.path.insert(0, str(MODEL_DIR))

from model import Decoder, PRED_MAP, TritonPythonModel  # noqa: E402


class TestViterbiDecoder:
    def test_instantiation(self):
        decoder = Decoder().eval()
        assert decoder is not None

    def test_transitions_shape(self):
        """Upstream port uses a 27-state internal tag set."""
        decoder = Decoder().eval()
        # `transitions` is a buffer or parameter — shape must be (27, 27).
        transitions = getattr(decoder, 'transitions', None)
        assert transitions is not None, 'Decoder has no `transitions` attribute'
        assert transitions.shape == (27, 27), f'expected (27,27), got {tuple(transitions.shape)}'

    def test_pred_map_is_f4_alphabet(self):
        assert PRED_MAP == {0: 'B', 1: 'b', 2: 'H', 3: 'h', 4: 'S', 5: 'i', 6: 'o'}

    def test_decode_all_outside(self):
        """Uniformly high-confidence 'outside' emissions (class index 4 = 'o' post-softmax)
        should decode to mostly tag 6 ('o') in the F4 mapping."""
        decoder = Decoder().eval()
        B, N = 1, 20
        # Class order [B, H, S, i, o] => index 4 = 'o'
        logits = torch.zeros(B, 5, N)
        logits[:, 4, :] = 10.0  # strong softmax peak at 'o'
        probs = F.softmax(logits, dim=1)
        mask = torch.ones(B, N)
        with torch.no_grad():
            decoded = decoder(probs, mask).byte()  # [B, N]
        assert decoded.shape == (B, N)
        letters = [PRED_MAP[int(v)] for v in decoded[0].tolist()]
        # At least 70% of residues should be 'o' (allow Viterbi boundary effects).
        assert letters.count('o') >= int(0.7 * N), f'expected mostly o, got {letters}'

    def test_decode_all_inside(self):
        """Analogous test for class index 3 = 'i'."""
        decoder = Decoder().eval()
        B, N = 1, 20
        logits = torch.zeros(B, 5, N)
        logits[:, 3, :] = 10.0  # class index 3 = 'i'
        probs = F.softmax(logits, dim=1)
        mask = torch.ones(B, N)
        with torch.no_grad():
            decoded = decoder(probs, mask).byte()
        letters = [PRED_MAP[int(v)] for v in decoded[0].tolist()]
        assert letters.count('i') >= int(0.7 * N), f'expected mostly i, got {letters}'

    def test_decode_output_range(self):
        """Decoded tag indices must be in the F4 alphabet range 0..6."""
        decoder = Decoder().eval()
        B, N = 1, 15
        probs = F.softmax(torch.randn(B, 5, N), dim=1)
        mask = torch.ones(B, N)
        with torch.no_grad():
            decoded = decoder(probs, mask).byte()
        assert (decoded >= 0).all() and (decoded <= 6).all()

    def test_decode_output_shape(self):
        """Decoder forward returns [B, N] tensor given [B, 5, N] emissions and [B, N] mask."""
        decoder = Decoder().eval()
        B, N = 2, 10
        probs = F.softmax(torch.randn(B, 5, N), dim=1)
        mask = torch.ones(B, N)
        with torch.no_grad():
            decoded = decoder(probs, mask)
        assert decoded.shape == (B, N), f'expected ({B}, {N}), got {tuple(decoded.shape)}'


class TestExecuteWrapper:
    """Cover TritonPythonModel.execute() — the cv-output -> Viterbi glue.

    The cv ONNX models emit channels-first [B, 5, N] (5 classes, N residues),
    TMbed's native conv layout. A regression here (e.g. an axis-order permute
    assuming channels-last [B, N, 5]) makes the whole `tmbed` ensemble unusable,
    so these tests pin the contract that earlier only the bare Decoder exercised.
    """

    @staticmethod
    def _run(cv_logits, mask):
        """cv_logits: list of 5 arrays [B, 5, N] (channels-first, as the cv ONNX emits)."""
        model = TritonPythonModel()
        model.initialize({})
        request = {f'output_{i}': _StubTensor(f'output_{i}', cv_logits[i]) for i in range(5)}
        request['mask'] = _StubTensor('mask', mask)
        resp = model.execute([request])[0]
        out = {t._name: t._arr for t in resp.output_tensors}
        label = out['labels'][0, 0]
        if isinstance(label, bytes):
            label = label.decode()
        return label, out['probabilities']

    @staticmethod
    def _peak(cls_idx, B=1, N=20):
        logits = np.zeros((B, 5, N), dtype=np.float32)
        logits[:, cls_idx, :] = 10.0
        return logits

    @pytest.mark.parametrize('cls_idx,letter', [(4, 'o'), (3, 'i')])
    def test_channels_first_peak_decodes(self, cls_idx, letter):
        """A channels-first [B,5,N] CV stack peaked at one class decodes to that
        class — proving execute() softmaxes over the class dim, not the residue dim."""
        N = 20
        cvs = [self._peak(cls_idx, N=N) for _ in range(5)]
        mask = np.ones((1, N), dtype=np.float32)
        label, probs = self._run(cvs, mask)
        assert probs.shape == (1, N, 5), f'probabilities must be [B,N,5], got {probs.shape}'
        frac = label.count(letter) / len(label)
        assert frac >= 0.7, f'expected mostly {letter!r}, got {label!r}'

    def test_label_length_matches_mask(self):
        """Label length equals the unmasked residue count; chars are all F4 alphabet."""
        B, N = 1, 25
        cvs = [np.random.randn(B, 5, N).astype(np.float32) for _ in range(5)]
        mask = np.ones((B, N), dtype=np.float32)
        mask[0, 20:] = 0.0  # last 5 padded
        label, probs = self._run(cvs, mask)
        assert len(label) == 20, f'expected 20 residues, got {len(label)}'
        assert set(label) <= set(PRED_MAP.values()), f'non-F4 chars in {label!r}'
        assert probs.shape == (B, N, 5)

    def test_rejects_channels_last_input(self):
        """Guard the regression directly: a channels-last [B,N,5] stack with N!=5
        must NOT silently decode — the wrapper expects channels-first [B,5,N]."""
        B, N = 1, 20
        cvs = [np.random.randn(B, N, 5).astype(np.float32) for _ in range(5)]
        mask = np.ones((B, N), dtype=np.float32)
        with pytest.raises(Exception):
            self._run(cvs, mask)
