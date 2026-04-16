# syntax=docker/dockerfile:1.7
# For fully reproducible builds, pin the base image by digest, e.g.
#   FROM node:22-alpine@sha256:<digest> AS build
# Resolve the current digest with: docker buildx imagetools inspect node:22-alpine

FROM node:25-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:25-alpine

# Override at build time. Recommended: derive from package.json so the
# example never goes stale:
#   V=$(node -p "require('./package.json').version")
#   docker build --build-arg VERSION=$V -t simplemdm-mcp:$V .
ARG VERSION=dev

LABEL org.opencontainers.image.title="simplemdm-mcp" \
      org.opencontainers.image.description="MCP server for SimpleMDM — query and manage your MDM fleet." \
      org.opencontainers.image.source="https://github.com/hov172/SimpleMDM-MCP" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node

CMD ["node", "dist/index.js"]
