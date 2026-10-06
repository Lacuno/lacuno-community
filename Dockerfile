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
    && pnpm --filter @lacuno/editor build \
    && pnpm --filter @lacuno/server build

FROM dependencies AS production-dependencies
RUN pnpm install --prod --frozen-lockfile

# The screenshots service (`--target screenshots`): Playwright at the lockfile's version with only
# its headless Chromium, and the bundled screenshot-main.
FROM dependencies AS screenshots-build
RUN pnpm install --frozen-lockfile \
    && pnpm --filter @lacuno/server build \
    && npm install --prefix /screenshots "playwright@$(node -p "require('playwright/package.json').version")"

FROM node:22-bookworm-slim AS screenshots
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=screenshots-build /screenshots/node_modules /app/node_modules
RUN npx playwright install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/*
COPY --from=screenshots-build /app/apps/server/dist/screenshot-main.js /app/screenshot-main.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "screenshot-main.mjs"]

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    LACUNO_PUBLISH_PORT=3001 \
    LACUNO_DATA_DIR=/data \
    LACUNO_ALLOW_SIGNUP=false \
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
# Each thread that allocates gets a malloc arena of its own, which keeps what it freed: an editing
# runtime held up to 40 MB more through V8's background compiler and garbage collector, which the
# runtime's one CPU does not need. Node's fetch parses with a WebAssembly module whose optimizing
# compile took another 18 MB; its baseline code is fast enough for the few requests a runtime sends.
CMD ["node", "--single-threaded", "--liftoff-only", "apps/server/dist/main.js"]
