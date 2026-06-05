FROM oven/bun:1.3-alpine@sha256:a108a3f67197646f1f975ff70237a45034d313d255051cd54e98c64737c1d204 AS pruner
WORKDIR /app
COPY . .
RUN bunx turbo prune @protifer/mock-triton --docker

FROM oven/bun:1.3-alpine@sha256:a108a3f67197646f1f975ff70237a45034d313d255051cd54e98c64737c1d204 AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN bun -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.workspaces=(p.workspaces||[]).filter(w=>w!=='scripts');fs.writeFileSync('package.json',JSON.stringify(p,null,2))"
RUN bun install

FROM oven/bun:1.3-alpine@sha256:a108a3f67197646f1f975ff70237a45034d313d255051cd54e98c64737c1d204 AS runner
WORKDIR /app
COPY --from=installer /app .
COPY --from=pruner /app/out/full/ .
WORKDIR /app/infra/mock-triton
CMD ["bun", "server.ts"]
