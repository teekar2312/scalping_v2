# Frontend Dockerfile - Next.js 16 standalone (Sprint 8 #18)
#
# Multi-stage build: build with node:20-alpine + bun, then copy the
# standalone output into a slim runtime image.
#
# Build:
#   docker build -t forex-frontend .
# Run:
#   docker run -p 3000:3000 forex-frontend

# ---- Stage 1: build ----
FROM node:20-alpine AS builder

# Install bun (faster than npm/yarn for this codebase)
RUN apk add --no-cache curl bash \
    && curl -fsSL https://bun.sh/install | bash \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun

WORKDIR /app

# Copy manifests first (cache deps)
COPY package.json bun.lock* ./
# Use bun for the install - it's faster and supports the lockfile
RUN bun install --frozen-lockfile || bun install

# Copy the rest of the source
COPY . .

# Build the Next.js app (output: standalone mode configured in next.config.ts)
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# ---- Stage 2: runtime ----
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copy the standalone server, static assets and public dir
# (the build script in package.json already copies .next/static + public
# into .next/standalone - see "build": "next build && cp -r ...")
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/standalone/.next/static ./.next/static
COPY --from=builder /app/.next/standalone/public ./public

EXPOSE 3000

# Next.js standalone server doesn't need a process manager
CMD ["node", "server.js"]
