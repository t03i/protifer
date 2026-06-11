# infra

Dev/test compose stacks + the sources CI builds prod images from.

- `docker-compose.{dev,test}.yml` — local stacks (triton-stub, garage, postgres, redis).
- `triton-stub/` — the dev/CI Triton: a **real** `tritonserver` (py3-min + python backend) that serves python-identity stubs. At boot, `entrypoint.py` derives a python-backed model repository from the real `../model-repository` (mounted read-only) so it can't drift from prod; `identity_model.py` returns shape/dtype-correct zeros. See the bump ritual below.
- `triton/` — Triton serves on the stock `nvcr.io/nvidia/tritonserver` image (no project-built serving image). Its model repository is now a locally-built OCI artifact (`scripts/build-model-artifact.py`) pulled by a stock `oras` one-shot in the deploy repos; the CPU conda-pack execution env (`cpu_py312.tar.gz`) ships inside that artifact.
- `garage/` — `garage.toml` + `garage-init/` used by the dev/test stacks; the init image is also built by CI for prod.
- `postgres/seeds/` — dev seed SQL.

The prod stacks themselves are owned by the private `<deploy-org>/deploy-{state,app}` repos.

## Triton stub bump ritual

The stub image (`ghcr.io/t03i/protifer-triton-stub:<tag>`) is intentionally
contract-free — it carries only `tritonserver` + the python backend. The model
contract is read live from `../model-repository` at every boot, so:

- **A `config.pbtxt` / contract change needs nothing here.** The next stub boot
  re-derives `/models` from the changed source. There is no committed copy to
  regenerate and no freshness gate.
- **Only a production Triton version bump touches the image.** Its base tag is
  pinned equal to the prod Triton tag (`-py3-min`), which is the whole point —
  the proto/shape contract stays in lockstep with prod. When prod Triton bumps,
  edit the `:<tag>` in `docker-compose.{dev,test}.yml` to match — that's it.
  CI's `triton-stub-image` job (`.github/workflows/ci.yml`) reads the tag from
  the test compose and, if GHCR doesn't already have it, composes and pushes it
  on the PR via `infra/triton-stub/build.sh` — so the bump is self-contained and
  goes green without a manual step. Normal runs are a sub-second manifest check.

  To overwrite an existing tag (e.g. the upstream base image moved under the same
  tag) or pre-seed out of band, run the manual **Triton stub image** workflow
  (`.github/workflows/triton-stub.yml`, `workflow_dispatch`) or `build.sh` by hand:

  ```bash
  echo "$GHCR_TOKEN" | docker login ghcr.io -u t03i --password-stdin
  VERSION=25.06 PUSH=1 infra/triton-stub/build.sh
  ```

The deploy repos' RUNBOOKs reference this ritual; the script, workflows, and the
contract all live here.

## Applying dev seeds

The `migrate` service runs better-auth schema migrations only; it does not apply
seed SQL. After `docker compose up` and at least one OAuth sign-in to create
the dev users, apply seeds manually:

```bash
docker compose exec -T postgres psql -U protifer -d protifer < infra/postgres/seeds/dev-users-plan.sql
```

Re-running is safe — seeds use idempotent `UPDATE` statements.
