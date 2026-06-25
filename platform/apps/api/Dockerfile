# platform/apps/api/Dockerfile — build from the platform/ workspace root:
#   docker build -f apps/api/Dockerfile -t bridge-api .
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm -r build

FROM node:20-slim
RUN corepack enable
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
ENV PORT=4000
EXPOSE 4000
CMD ["node", "dist/src/server.js"]
