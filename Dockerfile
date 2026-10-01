# syntax=docker/dockerfile:1

ARG NODE_VERSION=24-alpine

# ==========================================
# STAGE 1: Dependencies (deps)
# ==========================================
FROM node:${NODE_VERSION} AS deps

# Install native dependencies required by Alpine musl libc for Prisma query engine
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copy dependency manifests & Prisma schema for efficient Docker layer caching
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Cleanly install full dependencies (including devDependencies needed for build)
RUN npm ci --ignore-scripts && npm cache clean --force

# ==========================================
# STAGE 2: Builder
# ==========================================
FROM node:${NODE_VERSION} AS builder

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Pull cached node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client binary tailored to Alpine linux-musl
RUN npx prisma generate

# Compile production Remix / React Router application assets
RUN npm run build

# Prune development dependencies to keep final artifact lightweight
RUN npm prune --omit=dev && npm cache clean --force

# ==========================================
# STAGE 3: Runner (Production)
# ==========================================
FROM node:${NODE_VERSION} AS runner

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy application files with unprivileged 'node' user ownership
COPY --chown=node:node package.json package-lock.json* ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node public ./public
COPY --chown=node:node --from=builder /app/build ./build
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh

# Run as non-root user for container security
USER node

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
