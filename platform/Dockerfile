# Bridge platform API (Fastify + tRPC + Universal Action Pipeline + Google integration).
# A long-running Node server — host it on a Node service (Render / Railway / Fly / a VPS),
# NOT on Cloudflare Pages/Workers (those are for the static prototype, not a Fastify server).
#
# Build context = this `platform/` directory:  docker build -t bridge-api ./platform
#
# Persistence: the LOCAL plane (OAuth tokens + private relationship data) lives in
# BRIDGE_LOCAL_DIR — point it at a MOUNTED PERSISTENT VOLUME (e.g. /data/local) so the
# Google connection survives restarts/redeploys. Without a persistent volume you must
# re-connect Google after every deploy.
FROM node:22-slim

RUN corepack enable
WORKDIR /app

# Install deps first (better layer caching), then the source.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile && pnpm build

# Defaults — override GOOGLE_* / BRIDGE_* / DATABASE_URL / BRIDGE_APP_URL in the host's env.
ENV PORT=4000
ENV BRIDGE_LOCAL_DIR=/data/local
EXPOSE 4000

# cwd = /app (the platform root); the server reads config from process env (the host injects it).
CMD ["node", "apps/api/dist/src/server.js"]
