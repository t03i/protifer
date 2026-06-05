# infra

Dev/test compose stacks + the sources CI builds prod images from.

- `docker-compose.{dev,test}.yml` — local stacks (mock-triton, garage, postgres, redis).
- `triton/` — Triton serves on the stock `nvcr.io/nvidia/tritonserver` image (no project-built serving image). CI builds only `Dockerfile.init` (`init_models.py` + the baked CPU conda-pack execution env `cpu_py312.tar.gz`).
- `garage/` — `garage.toml` + `garage-init/` used by the dev/test stacks; the init image is also built by CI for prod.
- `postgres/seeds/` — dev seed SQL.

The prod stacks themselves are owned by the private `<deploy-org>/deploy-{state,app}` repos.

## Applying dev seeds

The `migrate` service runs better-auth schema migrations only; it does not apply
seed SQL. After `docker compose up` and at least one OAuth sign-in to create
the dev users, apply seeds manually:

```bash
docker compose exec -T postgres psql -U protifer -d protifer < infra/postgres/seeds/dev-users-plan.sql
```

Re-running is safe — seeds use idempotent `UPDATE` statements.
