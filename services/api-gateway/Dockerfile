FROM oven/bun:1.3-alpine@sha256:a108a3f67197646f1f975ff70237a45034d313d255051cd54e98c64737c1d204 AS pruner
WORKDIR /app
COPY . .
RUN bunx turbo prune @protifer/api-gateway --docker

FROM oven/bun:1.3-alpine@sha256:a108a3f67197646f1f975ff70237a45034d313d255051cd54e98c64737c1d204 AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN bun -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.workspaces=(p.workspaces||[]).filter(w=>w!=='scripts');fs.writeFileSync('package.json',JSON.stringify(p,null,2))"
RUN bun install

FROM oven/bun:1.3-alpine@sha256:a108a3f67197646f1f975ff70237a45034d313d255051cd54e98c64737c1d204 AS runner
WORKDIR /app
COPY --from=installer --chown=bun:bun /app .
COPY --from=pruner --chown=bun:bun /app/out/full/ .
WORKDIR /app/services/api-gateway

ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA

# Drop privileges. `oven/bun:*-alpine` ships with a non-root `bun` user
# (uid 1000) — use it. PORT is a non-privileged port (default 3001).
USER bun

# Liveness-style container HEALTHCHECK. Uses `bun` itself to fetch /health so
# we don't depend on curl/wget being present in the alpine image. For
# dep-aware readiness, point the orchestrator's separate readiness probe at
# /ready (returns 503 when Redis/Postgres are down).

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT||'3001')+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["bun", "src/index.ts"]
