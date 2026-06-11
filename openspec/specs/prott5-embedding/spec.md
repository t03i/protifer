# prott5-embedding Specification

## Purpose

Define how the ProtT5 embedding pipeline produces per-residue embeddings that
match the reference ProtT5 extraction the downstream classifiers were trained on.
The ProtT5 tokenizer appends an EOS (`</s>`) special token; this capability
ensures that token is stripped from the embedding output (while still attended
during the encoder forward pass), that the embedding worker enforces the
one-row-per-residue invariant before storing, and that the supporting Triton
post-process model is registered, served, and hidden from the public prediction
suite.

## Requirements

### Requirement: ProtT5 embeddings exclude the EOS special token

The `prot_t5_pipeline` ensemble SHALL emit exactly one embedding row per input
residue. The trailing `</s>` (EOS) token that the ProtT5 tokenizer appends SHALL
NOT appear in the `embeddings` output, and no leading/CLS token row SHALL be
present. EOS SHALL remain present during the encoder forward pass — it is removed
only from the output — so that the per-residue embeddings match the reference
ProtT5 extraction the downstream classifiers were trained on.

#### Scenario: Single sequence output is residue-length

- **WHEN** a sequence of `L` residues is embedded via `prot_t5_pipeline`
- **THEN** the `embeddings` tensor has shape `[L, 1024]`
- **AND** the row that would have corresponded to the EOS token is absent.

#### Scenario: Residue embeddings are unchanged by the strip

- **WHEN** the EOS row is removed from the encoder output
- **THEN** rows `0..L-1` are byte-identical to the encoder's `last_hidden_state`
  rows `0..L-1` (the forward pass still runs with EOS attended).

#### Scenario: EOS removal is per-sequence under batching

- **WHEN** the encoder produces a right-padded batch `[B, T, 1024]` for sequences
  of differing lengths
- **THEN** the post-process step uses `attention_mask` to drop each sequence's
  single trailing EOS position (`length = sum(mask) - 1`)
- **AND** the surviving real-residue rows for each sequence are preserved as a
  contiguous prefix, re-padded with zeros to the batch's longest post-strip
  length.

### Requirement: Embedding worker enforces the per-residue invariant

The embedding worker SHALL verify that the embedding returned by Triton contains
exactly one row per input residue before storing it. If the row count does not
equal the input sequence length, the worker SHALL fail the job loudly rather than
store or propagate a mis-sized embedding.

#### Scenario: Correct row count is accepted

- **WHEN** Triton returns an embedding whose FP16 byte length equals
  `sequenceLength * 1024 * 2`
- **THEN** the worker stores the embedding to object storage.

#### Scenario: Wrong row count is rejected

- **WHEN** Triton returns an embedding whose row count differs from the input
  sequence length (e.g. an EOS or leading token leaked through)
- **THEN** the worker throws an error and does not store the embedding.

### Requirement: New post-process model is registered and served

The ProtT5 EOS post-process model SHALL be a Triton python-backend model
registered as an `internal` entry in the model inventory and packaged into the
OCI model artifact, so that Triton serves it and the gateway excludes it from the
public prediction suite.

#### Scenario: Post-process model loads with the ensemble

- **WHEN** Triton starts against the model repository
- **THEN** the post-process model and the `prot_t5_pipeline` ensemble both report
  READY.

#### Scenario: Internal model is hidden from the suite

- **WHEN** the gateway derives its model inventory
- **THEN** the post-process model is present in the served Triton set but absent
  from the public prediction suite.
