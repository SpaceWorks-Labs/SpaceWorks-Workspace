# syntax=docker/dockerfile:1
# check=skip=SecretsUsedInArgOrEnv
# (The skipped check flags the NEXT_SERVER_ACTIONS_ENCRYPTION_KEY build-arg
# fallback in the builder stage; see the comment there for the tradeoff.)

# Stage 1: Install dependencies
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY frontend/package.json ./frontend/package.json
# `npm ci` runs the Prisma postinstall hook, which needs the schema available.
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci

# A small migration-only target, used by the staging Compose file. Releases
# migrate with the backend image's `migrate` role instead.
# scripts/prisma.mjs defaults DIRECT_URL to DATABASE_URL when it is unset.
FROM deps AS migrator
WORKDIR /app
COPY prisma ./prisma
COPY scripts/prisma.mjs ./scripts/prisma.mjs
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
CMD ["node", "scripts/prisma.mjs", "migrate", "deploy"]

# Prisma CLI only, pinned to the lockfile's version, so the runner can apply
# migrations on start (MIGRATE_ON_START=1) on platforms without a release job,
# such as the Render free plan. Kept apart from the app's node_modules.
FROM node:22-alpine AS prisma-cli
WORKDIR /opt/prisma-cli
COPY --from=deps /app/node_modules/prisma/package.json /tmp/prisma-package.json
COPY --from=deps /app/package.json /tmp/root-package.json
RUN node -e "const fs=require('fs'); const root=require('/tmp/root-package.json'); fs.writeFileSync('package.json',JSON.stringify({private:true,overrides:root.overrides||{}}))" \
    && npm install --omit=dev --no-save --no-audit --no-fund \
      "prisma@$(node -p "require('/tmp/prisma-package.json').version")" \
    && npm cache clean --force

# Clients the VPS operator tools (docker/vps/*.mjs) import, pinned to the
# lockfile's versions. The application bundles its own copies into its build.
FROM node:22-alpine AS ops-modules
WORKDIR /opt/ops
COPY --from=deps /app/node_modules/ioredis/package.json /tmp/ioredis-package.json
COPY --from=deps /app/node_modules/@aws-sdk/client-s3/package.json /tmp/s3-package.json
COPY --from=deps /app/node_modules/nodemailer/package.json /tmp/nodemailer-package.json
COPY --from=deps /app/node_modules/bullmq/package.json /tmp/bullmq-package.json
COPY --from=deps /app/package.json /tmp/root-package.json
RUN node -e "const fs=require('fs'); const root=require('/tmp/root-package.json'); fs.writeFileSync('package.json',JSON.stringify({private:true,overrides:root.overrides||{}}))" \
    && npm install --omit=dev --no-save --no-audit --no-fund \
      "ioredis@$(node -p "require('/tmp/ioredis-package.json').version")" \
      "@aws-sdk/client-s3@$(node -p "require('/tmp/s3-package.json').version")" \
      "nodemailer@$(node -p "require('/tmp/nodemailer-package.json').version")" \
      "bullmq@$(node -p "require('/tmp/bullmq-package.json').version")" \
    && npm cache clean --force

# Stage 2: Rebuild the source code
FROM node:22-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_BASE_URL
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL
# Fallback for builders without BuildKit secrets wired up. Render passes every
# service environment variable to `docker build` as a build arg of the same
# name, so the runtime key is reused for the build without extra setup. The
# value then exists in this builder stage's metadata and build cache, but not
# in the final runner image (a separate stage). Prefer the secret mount below
# wherever the builder supports it (local Docker, GitHub Actions, Compose).
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# This stage starts fresh; avoid writing a compiler cache that the runner never uses.
ENV SWW_DISABLE_BUILD_CACHE=1
ENV NODE_OPTIONS=--max-old-space-size=4096

RUN npx prisma generate && npm run build:jobs
# The key is consumed by Next.js while compiling Server Actions. Every image
# replica must be built with one stable key and receive that same key at runtime.
# A BuildKit secret (`--secret id=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,...`, or a
# Render secret file with that name) takes precedence over the build arg.
RUN --mount=type=secret,id=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY \
    if [ -s /run/secrets/NEXT_SERVER_ACTIONS_ENCRYPTION_KEY ]; then \
      NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(cat /run/secrets/NEXT_SERVER_ACTIONS_ENCRYPTION_KEY)"; \
    fi; \
    if [ -z "$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY" ]; then \
      echo "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY is required: pass it as a BuildKit secret or build arg." >&2; \
      exit 1; \
    fi; \
    export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY; \
    npm run build

# The separately deployable rendering frontend (the frontend/ workspace),
# published as spaceworks-workspace-frontend. It holds no database, mail, Redis or
# storage client and reaches the backend only through the authenticated gateway.
FROM node:22-alpine AS frontend-builder
WORKDIR /app
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_BACKEND_ORIGIN
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL
ENV NEXT_PUBLIC_BACKEND_ORIGIN=$NEXT_PUBLIC_BACKEND_ORIGIN
ENV BACKEND_ORIGIN=$NEXT_PUBLIC_BACKEND_ORIGIN
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
COPY --from=deps /app ./
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV SWW_DISABLE_BUILD_CACHE=1
ENV NODE_OPTIONS=--max-old-space-size=4096
ENV SWW_FRONTEND_STANDALONE=1
RUN npx prisma generate
RUN --mount=type=secret,id=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY \
    if [ -s /run/secrets/NEXT_SERVER_ACTIONS_ENCRYPTION_KEY ]; then \
      NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(cat /run/secrets/NEXT_SERVER_ACTIONS_ENCRYPTION_KEY)"; \
    fi; \
    if [ -z "$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY" ]; then \
      echo "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY is required: pass it as a BuildKit secret or build arg." >&2; \
      exit 1; \
    fi; \
    export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY; \
    npm run build:frontend

FROM node:22-alpine AS frontend
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
# Standalone output for a workspace keeps its path below the repository root.
COPY --from=frontend-builder --chown=nextjs:nodejs /app/frontend/.next/standalone ./
COPY --from=frontend-builder --chown=nextjs:nodejs /app/frontend/.next/static ./frontend/.next/static
COPY --from=frontend-builder --chown=nextjs:nodejs /app/frontend/public ./frontend/public
COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN rm -f frontend/.env frontend/.env.local frontend/.env.production .env
# Runtime roles invoke Node directly; package management stays in build stages.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
# Where docker-entrypoint.sh finds the build to apply the public origins to.
ENV SWW_NEXT_DIR=/app/frontend/.next
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/brand/icon-192.png').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "frontend/server.js"]

# Stage 3: Production runner, published as spaceworks-workspace-backend (keep this
# the LAST stage: Render builds the final stage because a Blueprint cannot
# select a build target). The same image applies migrations (`migrate`) and
# runs the VPS operator tools (scripts/, docker/vps/) as root.
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Sharp renders images and previews on the server. Alpine needs fonts for text.
# OpenSSL creates the VPS's private CA and service certificates (ops role).
RUN apk add --no-cache font-dejavu fontconfig openssl && fc-cache -f

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public

RUN mkdir .next
RUN chown nextjs:nodejs .next

# Leverage Next.js standalone tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist

# Prisma CLI for the optional MIGRATE_ON_START=1 path (root-owned, read-only).
COPY --from=prisma-cli /opt/prisma-cli/node_modules /opt/prisma-cli/node_modules
COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Operator tools (setup, preflight, schema checks, smoke tests), root-owned.
COPY scripts/*.mjs ./scripts/
COPY docker/vps ./docker/vps
COPY --from=ops-modules /opt/ops/node_modules ./docker/vps/node_modules

# Next's standalone trace may include dotenv files when a build is performed
# from a developer checkout. Secrets belong only in the runtime environment.
RUN rm -f .env .env.local .env.production .env.development

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
