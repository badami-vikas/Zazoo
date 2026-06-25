# Tools/recon/Dockerfile — build context is Tools/recon/
# This project needs --legacy-peer-deps (see project memory).
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=build /app /app
ENV PORT=3000
EXPOSE 3000
# data/ is the JSONL store — mounted from a Fly volume (see fly.toml) so it persists.
# `next start` respects the PORT env var.
CMD ["npm", "run", "start"]
