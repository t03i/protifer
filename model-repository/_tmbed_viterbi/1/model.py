# SPDX-License-Identifier: GPL-3.0-only
# -------------------------------------------------------------------
# Viterbi decoder for TMbed transmembrane topology prediction.
#
# Decoder class ported verbatim from:
#   github.com/BernhoferM/TMbed  tmbed/viterbi.py
#   commit 8cee893523eb655bc9485c00c65336d27a236191
#   blob SHA 3d69f6530055ecf37a7ec630ecc78d6601454c72
#   (c) 2022 Rostlab, Apache-2.0
# Integrated under GPL-3.0-only §4 with attribution.
# -------------------------------------------------------------------

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import triton_python_backend_utils as pb_utils


# ======== BEGIN VERBATIM PORT from BernhoferM/TMbed tmbed/viterbi.py ========
# Copyright 2022 Rostlab
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.


class Decoder(nn.Module):

    def __init__(self):
        super().__init__()

        self._init_transitions()

    def _init_transitions(self):
        num_tags = 27

        end_transitions = torch.full((num_tags,), -100)
        start_transitions = torch.full((num_tags,), -100)

        transitions = torch.full((num_tags, num_tags), -100)

        for i in [0, 5, 10, 15, 20, -2, -1]:
            start_transitions[i] = 0  # B1a, B1b, H1a, H1b, S1, i, o

        for i in range(4):
            transitions[0+i, 1+i] = 0    # Bxa -> Bya
            transitions[5+i, 6+i] = 0    # Bxb -> Byb
            transitions[10+i, 11+i] = 0  # Hxa -> Hya
            transitions[15+i, 16+i] = 0  # Hxb -> Hyb
            transitions[20+i, 21+i] = 0  # Sx  -> Sy

        for i in [4, 9, 14, 19, 24]:
            transitions[i, i] = 0  # X5 -> X5

        transitions[4, -1] = 0    # B5a -> o
        transitions[9, -2] = 0    # B5b -> i
        transitions[14, -1] = 0   # H5a -> o
        transitions[19, -2] = 0   # H5b -> i
        transitions[24, -2:] = 0  # S5  -> (i, o)

        transitions[-2, 0] = 0    # i -> B1a
        transitions[-2, 10] = 0   # i -> H1a
        transitions[-2, -2:] = 0  # i -> (i, o)

        transitions[-1, 5] = 0    # o -> B1b
        transitions[-1, 15] = 0   # o -> H1b
        transitions[-1, -2:] = 0  # o -> (i, o)

        for i in [4, 9, 14, 19, 24, -2, -1]:
            end_transitions[i] = 0  # B5a, B5b, H5a, H5b, S5, i, o

        repeats = torch.tensor([10, 10, 5, 1, 1], dtype=torch.int32)

        mapping = torch.arange(7, dtype=torch.int32)
        mapping = mapping.repeat_interleave(torch.tensor([5, 5,  # B
                                                          5, 5,  # H
                                                          5,     # S
                                                          1,     # i
                                                          1]))   # o

        assert repeats.sum() == num_tags
        assert mapping.shape == (num_tags,)

        self.register_buffer('transitions', tensor=transitions)
        self.register_buffer('end_transitions', tensor=end_transitions)
        self.register_buffer('start_transitions', tensor=start_transitions)

        self.register_buffer('repeats', tensor=repeats)
        self.register_buffer('mapping', tensor=mapping)

    def forward(self, emissions, mask):
        mask = mask.transpose(0, 1).bool()

        emissions = emissions.permute(2, 0, 1)
        emissions = emissions.repeat_interleave(self.repeats, dim=2)

        decoded = self._viterbi_decode(emissions, mask)
        decoded = self.mapping[decoded]

        return decoded

    def _viterbi_decode(self, emissions, mask):
        device = emissions.device

        seq_length, batch_size, num_tags = emissions.shape

        score = self.start_transitions + emissions[0]

        history = torch.zeros((seq_length, batch_size, num_tags),
                              dtype=torch.long, device=device)

        for i in range(1, seq_length):
            next_score = (self.transitions
                          + score.unsqueeze(2)
                          + emissions[i].unsqueeze(1))

            next_score, indices = next_score.max(dim=1)

            score = torch.where(mask[i].unsqueeze(-1), next_score, score)

            history[i - 1] = indices

        score = score + self.end_transitions

        _, end_tag = score.max(dim=1)

        seq_ends = mask.long().sum(dim=0) - 1

        history = history.transpose(1, 0)

        history.scatter_(1,
                         seq_ends.view(-1, 1, 1).expand(-1, 1, num_tags),
                         end_tag.view(-1, 1, 1).expand(-1, 1, num_tags))

        history = history.transpose(1, 0)

        best_tags = torch.zeros((batch_size, 1), dtype=torch.long,
                                device=device)

        best_tags_arr = torch.zeros((seq_length, batch_size), dtype=torch.long,
                                    device=device)

        for idx in range(seq_length - 1, -1, -1):
            best_tags = torch.gather(history[idx], 1, best_tags)

            best_tags_arr[idx] = best_tags.view(batch_size)

        return best_tags_arr.transpose(0, 1)

# ========  END VERBATIM PORT  ========


# F4 alphabet mapping (tag index -> letter), per RESEARCH.md §3 + tmbed/tmbed.py:245-251.
PRED_MAP = {0: 'B', 1: 'b', 2: 'H', 3: 'h', 4: 'S', 5: 'i', 6: 'o'}


class TritonPythonModel:
    def initialize(self, args):
        """Instantiate the Viterbi decoder once per Triton model instance."""
        self.decoder = Decoder().eval()

    def execute(self, requests):
        """Per-request: softmax each of 5 CV logits along class dim, mean across CVs,
        feed [B, 5, N] into Viterbi, emit labels (BYTES [B, 1]) + probabilities
        (FP32 [B, N, 5]). Mirrors tmbed/tmbed.py predict_sequences (Pitfall 3)."""
        responses = []
        for request in requests:
            # Each cv ONNX emits channels-first [B, 5, N] (5 classes, N residues) —
            # TMbed's native conv layout. This is already torch's [B, C, N], so no
            # permute: softmax runs over the class dim (dim=1) directly.
            cvs = []
            for i in range(5):
                t = pb_utils.get_input_tensor_by_name(request, f'output_{i}').as_numpy()
                cvs.append(torch.from_numpy(t).float())  # [B, 5, N]

            mask = torch.from_numpy(
                pb_utils.get_input_tensor_by_name(request, 'mask').as_numpy()
            ).float()  # [B, N]

            # CRITICAL (Pitfall 3): softmax EACH CV along class dim, THEN mean across CVs.
            probs = torch.stack(
                [F.softmax(cv, dim=1) for cv in cvs], dim=0
            ).mean(dim=0)  # [B, 5, N]

            # Run Viterbi. Returns [B, N] tag indices in 0..6 after the 27->7 internal mapping.
            decoded_tags = self.decoder(probs, mask).byte()  # [B, N]

            B, N = decoded_tags.shape
            labels = np.empty((B, 1), dtype=object)
            for b in range(B):
                seq_len = int(mask[b].sum().item())
                labels[b, 0] = ''.join(PRED_MAP[int(v)] for v in decoded_tags[b, :seq_len].tolist())

            # Emit probabilities in KServe row-major [B, N, 5].
            probs_out = probs.permute(0, 2, 1).numpy().astype(np.float32)

            responses.append(pb_utils.InferenceResponse(output_tensors=[
                pb_utils.Tensor('labels', labels),
                pb_utils.Tensor('probabilities', probs_out),
            ]))
        return responses
