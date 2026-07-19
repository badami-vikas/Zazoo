# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

FROM base AS pruner
WORKDIR /workspace
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm dlx turbo@2.9.16 prune @bridge/api --docker

FROM base AS builder
WORKDIR /workspace
COPY --from=pruner /workspace/out/json/ ./
COPY --from=pruner /workspace/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile
COPY --from=pruner /workspace/out/full/ ./
COPY --from=pruner /workspace/tsconfig.base.json ./tsconfig.base.json
RUN pnpm turbo run build --filter=@bridge/api
RUN pnpm --filter @bridge/api deploy --legacy --prod /opt/bridge-api

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV PORT=4000
ENV BRIDGE_LOCAL_DIR=/var/lib/bridge/local
ENV BRIDGE_FILES_ROOT=/var/lib/bridge/files
WORKDIR /app

RUN groupadd --gid 10001 bridge && \
    useradd --uid 10001 --gid bridge --create-home --shell /usr/sbin/nologin bridge && \
    mkdir -p /var/lib/bridge/local /var/lib/bridge/files && \
    chown -R bridge:bridge /var/lib/bridge
COPY --from=builder --chown=bridge:bridge /opt/bridge-api/ ./

USER 10001:10001
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/src/server.js"]
