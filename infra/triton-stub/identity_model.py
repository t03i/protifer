# SPDX-License-Identifier: GPL-3.0-only
# -------------------------------------------------------------------
# Identity stub for the dev/CI Triton test stack.
#
# Copied (by entrypoint.py, at container boot) into every LEAF model's
# `1/model.py` in the derived stub repo. It returns correctly-TYPED,
# correctly-SHAPED zeros for every declared output, reading its own
# model_config so one file serves every leaf.
#
# It exists so a REAL tritonserver can honour the real config.pbtxt wire
# contract in dev/CI without any weights or backend beyond python. It
# validates protocol + shape, NOT numerical output. The real configs are the
# single source of truth — this file is never committed into a model dir; it
# is injected at runtime from the mounted real model-repository.
#
# See openspec/changes/2026-06-10-real-triton-test-stack.
# -------------------------------------------------------------------

import json

import numpy as np
import triton_python_backend_utils as pb_utils

# Triton data_type string -> numpy dtype. TYPE_STRING is handled separately
# as a numpy object array of bytes (KServe BYTES).
_NP_DTYPE = {
    "TYPE_BOOL": np.bool_,
    "TYPE_UINT8": np.uint8,
    "TYPE_UINT16": np.uint16,
    "TYPE_UINT32": np.uint32,
    "TYPE_UINT64": np.uint64,
    "TYPE_INT8": np.int8,
    "TYPE_INT16": np.int16,
    "TYPE_INT32": np.int32,
    "TYPE_INT64": np.int64,
    "TYPE_FP16": np.float16,
    "TYPE_FP32": np.float32,
    "TYPE_FP64": np.float64,
}

# Fallback length for a dynamic (-1) output dim when nothing in the inputs
# offers a length to copy.
_DEFAULT_DYNAMIC = 16


class TritonPythonModel:
    def initialize(self, args):
        cfg = json.loads(args["model_config"])
        self._max_batch = int(cfg.get("max_batch_size", 0))
        self._inputs = cfg.get("input", [])
        self._outputs = cfg.get("output", [])

    def _derive_dynamic_length(self, request):
        """Pick a length to fill output -1 dims from the inputs, so per-residue
        outputs track the submitted sequence length where possible. Best-effort
        (a stub returns zeros): STRING inputs use decoded content length;
        otherwise the largest non-batch input dim."""
        best = 0
        for spec in self._inputs:
            tensor = pb_utils.get_input_tensor_by_name(request, spec["name"])
            if tensor is None:
                continue
            arr = tensor.as_numpy()
            if spec["data_type"] == "TYPE_STRING":
                for value in arr.reshape(-1):
                    text = (
                        value.decode("utf-8", "ignore")
                        if isinstance(value, (bytes, bytearray))
                        else str(value)
                    )
                    best = max(best, len(text))
            else:
                # Skip the leading batch dim when batching is enabled.
                dims = arr.shape[1:] if self._max_batch > 0 else arr.shape
                for dim in dims:
                    best = max(best, int(dim))
        return best or _DEFAULT_DYNAMIC

    def _batch_size(self, request):
        if self._max_batch <= 0:
            return None
        for spec in self._inputs:
            tensor = pb_utils.get_input_tensor_by_name(request, spec["name"])
            if tensor is not None:
                return int(tensor.as_numpy().shape[0])
        return 1

    def execute(self, requests):
        responses = []
        for request in requests:
            batch = self._batch_size(request)
            dynamic = self._derive_dynamic_length(request)

            output_tensors = []
            for spec in self._outputs:
                dims = [int(d) for d in spec["dims"]]
                shape = [dynamic if d == -1 else d for d in dims]
                if batch is not None:
                    shape = [batch] + shape

                if spec["data_type"] == "TYPE_STRING":
                    arr = np.full(shape, b"", dtype=object)
                else:
                    arr = np.zeros(shape, dtype=_NP_DTYPE[spec["data_type"]])
                output_tensors.append(pb_utils.Tensor(spec["name"], arr))

            responses.append(
                pb_utils.InferenceResponse(output_tensors=output_tensors)
            )
        return responses
