# Copyright 2025 Tobias Olenyi.
# SPDX-License-Identifier: GPL-3.0-only

from __future__ import annotations

import numpy as np
import triton_python_backend_utils as pb_utils


def strip_eos(hidden: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Drop the trailing </s> row per sequence.

    hidden: [B, T, H] encoder states. mask: [B, T] attention mask (right-padded).
    ProtT5 appends one EOS and no leading token, so the real residues are the
    contiguous prefix of length sum(mask)-1. Surviving rows are re-padded with
    zeros to the batch's longest post-strip length.
    """
    lengths = mask.sum(axis=1).astype(np.int64) - 1
    np.clip(lengths, 0, None, out=lengths)
    max_len = int(lengths.max()) if lengths.size else 0
    out = np.zeros((hidden.shape[0], max_len, hidden.shape[2]), dtype=hidden.dtype)
    for b, length in enumerate(lengths):
        out[b, :length] = hidden[b, :length]
    return out


class TritonPythonModel:
    def execute(self, requests):
        responses = []
        for request in requests:
            hidden = pb_utils.get_input_tensor_by_name(
                request, "last_hidden_state"
            ).as_numpy()
            mask = pb_utils.get_input_tensor_by_name(
                request, "attention_mask"
            ).as_numpy()

            embeddings = strip_eos(hidden, mask)

            responses.append(
                pb_utils.InferenceResponse(
                    output_tensors=[pb_utils.Tensor("embeddings", embeddings)]
                )
            )
        return responses
