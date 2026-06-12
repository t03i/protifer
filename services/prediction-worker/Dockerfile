FROM oven/bun:1.3-alpine@sha256:a108a3f67197646f1f975ff70237a45034d313d255051cd54e98c64737c1d204 AS pruner
WORKDIR /app
COPY . .
RUN bunx turbo prune @protifer/prediction-worker --docker

FROM oven/bun:1.3-alpine@sha256:a108a3f67197646f1f975ff70237a45034d313d255051cd54e98c64737c1d204 AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN bun -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.workspaces=(p.workspaces||[]).filter(w=>w!=='scripts');fs.writeFileSync('package.json',JSON.stringify(p,null,2))"
RUN bun install

FROM oven/bun:1.3-alpine@sha256:a108a3f67197646f1f975ff70237a45034d313d255051cd54e98c64737c1d204 AS runner
WORKDIR /app
COPY --from=installer --chown=bun:bun /app .
COPY --from=pruner --chown=bun:bun /app/out/full/ .
WORKDIR /app/services/prediction-worker

# Bake the build SHA so the worker's Sentry init tags release=<sha> instead of
# "unknown" (packages/shared reads GIT_SHA). CI passes --build-arg GIT_SHA; an
# undeclared ARG would be silently dropped, so it must be declared here.
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA

# Drop privileges to the uid-1000 `bun` user that ships with oven/bun images.
# Worker does not open any listening port and does not write to the app dir
# at runtime (S3 + Redis are the only persistence paths).
USER bun

# Workers don't expose HTTP. A real queue-health check would require a
# sidecar; for now a liveness placeholder (process can exec bun) is enough
# to give orchestrators something to probe, matching the api-gateway cadence.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "process.exit(0)"

CMD ["bun", "src/index.ts"]
