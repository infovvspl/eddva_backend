# syntax=docker/dockerfile:1
# ── Stage 1: Build ───────────────────────────────────────────────────────────
# Debian (glibc) rather than Alpine: puppeteer needs Chromium and the bundled
# ffmpeg binaries are glibc builds, neither works reliably on musl.
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# ── Stage 2: Production dependencies only ────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=1
COPY package.json package-lock.json ./
# --ignore-scripts: skips husky's `prepare` (a devDependency) and the binary
# downloads; there are no native modules that need a build step.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ── Stage 3: Runtime ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS production
WORKDIR /app

# Chromium for puppeteer (document/PDF generation), ffmpeg for transcoding and
# the live-class RTMP relay, fonts so generated PDFs render Indic scripts.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ffmpeg ca-certificates fonts-noto-core fonts-noto-unhinted fonts-liberation tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    FFMPEG_PATH=/usr/bin/ffmpeg

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY package.json ./
COPY scripts/docker-migrate.js ./scripts/docker-migrate.js

# Upload dirs (mount a volume on /app/uploads to persist them)
RUN mkdir -p uploads/avatars uploads/videos uploads/thumbnails \
    && chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main"]
