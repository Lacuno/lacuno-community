# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
# Native SQLite can fall back to a source build when a prebuilt binary is unavailable.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.33.0
COPY . .

FROM dependencies AS build
RUN pnpm install --frozen-lockfile \
    && pnpm --filter @miralo/editor build \
    && pnpm --filter @miralo/server build

FROM dependencies AS production-dependencies
RUN pnpm install --prod --frozen-lockfile

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    MIRALO_PUBLISH_PORT=3001 \
    MIRALO_DATA_DIR=/data \
    MIRALO_ALLOW_SIGNUP=false \
    ASTRO_TELEMETRY_DISABLED=1
# Keep workspace source: Astro imports the compiler's TypeScript renderer at build time.
COPY --from=production-dependencies /app /app
COPY --from=build /app/apps/server/dist /app/apps/server/dist
COPY --from=build /app/apps/editor/dist /app/apps/editor/dist
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/server/dist/main.js"]
