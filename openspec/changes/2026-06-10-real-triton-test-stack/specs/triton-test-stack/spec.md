# triton-test-stack

## ADDED Requirements

### Requirement: Dev and integration stacks run a real Triton, not a protocol mock

The dev and integration stacks SHALL serve Triton requests from a real
`tritonserver` binary, not from a JavaScript gRPC reimplementation that loads the
client's own proto (`infra/docker-compose.dev.yml` and
`infra/docker-compose.test.yml`). A request that a production Triton would reject for wrong
proto field numbers, tensor rank, or dtype SHALL be rejected by this stack as
well. The `infra/mock-triton` server and `packages/triton-client/src/mock-server.ts`
SHALL be removed once the real-Triton path is green. The worker/gateway unit-test
double (a fake `TritonClient` object, no server) SHALL remain unchanged.

#### Scenario: A malformed request rejected by prod is rejected in CI

- **WHEN** a request is sent with a 1-D `sequences` tensor where the model
  requires a 2-D batched tensor (the `b22f755` bug shape)
- **THEN** the stack's Triton rejects it as a real `tritonserver` would
- **AND** the integration suite fails, rather than passing as it did against the mock.

#### Scenario: Unit tests do not depend on the stack

- **WHEN** worker or gateway unit tests run
- **THEN** they use the injected fake `TritonClient` and require no Triton
  container, Docker, or network.

### Requirement: The stub serves the real ensemble contract with shape-correct zeros

The test Triton image SHALL load the real ensemble model contracts
(`prot_t5_pipeline`, `tmbed`, `bind_embed`, and the active models listed in
`infra/triton/model-inventory.dev.json`) with their external input/output tensor
names, data types, and dimensions preserved. Leaf models MAY be replaced by
dependency-free python identity models that return zeros, provided each returned
tensor matches the declared name, dtype, and shape (including variable dimensions
derived from the inputs). The image SHALL NOT carry a conda execution environment.

#### Scenario: All active models report ready

- **WHEN** the stub stack starts with `--disable-auto-complete-config`
- **THEN** every model in `model-inventory.dev.json` reports READY via
  `/v2/health/ready` before dependents start (compose `--wait` blocks on it).

#### Scenario: An embedding request returns a correctly-shaped result

- **WHEN** a valid embedding request for a sequence of length L reaches
  `prot_t5_pipeline`
- **THEN** the response is an `embeddings` tensor of dtype FP16 and shape
  `[L, 1024]` (zeros), satisfying the same wire contract as prod.

### Requirement: The stub stays in lockstep with the production contract

The stub model-repository SHALL be derived at container start from the real
`model-repository/` (mounted read-only) and SHALL NOT be committed as a separate
copy, so it cannot drift from the production contract. The stub image SHALL be
built from `nvcr.io/nvidia/tritonserver:<tag>-py3-min` whose `<tag>` equals the
production Triton tag, so a production Triton bump forces a stub rebuild.

#### Scenario: A contract change is picked up without any copy to maintain

- **WHEN** a `config.pbtxt` in `model-repository/` changes
- **THEN** the next boot of the stub re-derives its repo from the changed source
- **AND** no second copy of the model-repository exists in the tree to update or
  gate.

#### Scenario: Stub image tag tracks prod Triton tag

- **WHEN** the production Triton base tag is bumped
- **THEN** the stub image's `-py3-min` base tag is bumped to match and the image
  is recomposed and re-pushed to `ghcr.io/t03i/protifer-triton-stub`.

### Requirement: The integration job fits the GitHub-hosted runner disk budget

The integration workflow SHALL pull only the composed stub image from GHCR (not
`nvcr.io`) and SHALL apply a disk strategy (Docker data-root on the larger
ephemeral volume, or a disk-reclaim step) so the ~6 GB stub image plus the rest of
the test stack fits the runner.

#### Scenario: The stack comes up within the disk budget

- **WHEN** the integration job brings up `infra/docker-compose.test.yml`
- **THEN** the stub image pulls from GHCR authenticated by `GITHUB_TOKEN`
- **AND** the stack reaches healthy without exhausting runner disk.
