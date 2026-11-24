# syntax=docker/dockerfile:1

# ============ 1. builder: full deps, seal first-party code to bytecode ============
FROM node:22-bookworm-slim AS builder
WORKDIR /app
# The builder only needs to compile code, not run Chromium - skip Puppeteer's
# browser download (it fails in this slim image and isn't needed here).
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package*.json ./
RUN npm ci
COPY . .
RUN node build/seal-tree.js          # -> build/dist/ (bytecode tree, no source)

# ============ 2. proddeps: runtime node_modules only (no Chromium download) ========
FROM node:22-bookworm-slim AS proddeps
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package*.json ./
RUN npm ci --omit=dev

# ============ 3. runtime: sealed app + system Chromium =============================
FROM node:22-bookworm-slim AS runtime
# The release this image was built from. CI passes the tag it published, so
# the Configuration screen can report what is actually deployed rather than
# package.json's version, which nothing bumps - it has read 1.0.0 across every
# release. Defaults to 'dev' for a local build, which is itself useful.
ARG APP_VERSION=dev
ENV ODYSSEY_APP_VERSION=$APP_VERSION
ENV NODE_ENV=production \
    PORT=8088 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# Chromium + fonts for invoice-PDF rendering; dumb-init for clean signal handling.
# LibreOffice (Writer, no GUI) turns a printing template - a client's own Word
# file, Configuration > Printing Templates - into its PDF (functions/
# printingTemplate). With it the fonts Word documents are laid out in, or ones
# the same size: Liberation for Arial / Times New Roman / Courier New, Carlito
# for Calibri, Caladea for Cambria - a missing font is what moves a line.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation ca-certificates dumb-init \
      libreoffice-writer-nogui fonts-liberation2 fonts-crosextra-carlito \
      fonts-crosextra-caladea fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=builder  /app/build/dist   ./
EXPOSE 8088
# run.js registers the .jsc loader and calls the app's exported start(). It
# listens on $PORT (8088). (We can't use `node index.jsc` directly: under
# bytenode require.main !== module, so index's self-start guard never fires.)
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "run.js"]
