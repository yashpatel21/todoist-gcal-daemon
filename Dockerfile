# syntax=docker/dockerfile:1.7

# ============================================================
# Stage 1: build TypeScript + compile native deps
# ============================================================
FROM node:22-bookworm-slim AS build

ENV NODE_ENV=development
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        build-essential \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build \
    && npm prune --omit=dev

# ============================================================
# Stage 2: minimal runtime image
# ============================================================
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    DATABASE_PATH=/app/data/sync.db

WORKDIR /app

RUN mkdir -p /app/data \
    && chown -R node:node /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./

USER node

VOLUME ["/app/data"]

# OAuth bootstrap listens on this port the first time the container is
# started without GOOGLE_REFRESH_TOKEN. Once the token is captured, the
# port mapping in docker-compose.yml is optional but harmless.
EXPOSE 8765

CMD ["node", "dist/index.js"]
