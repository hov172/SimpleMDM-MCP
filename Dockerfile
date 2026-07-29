# syntax=docker/dockerfile:1.7
# For fully reproducible builds, pin the base image by digest, e.g.
#   FROM node:26-alpine@sha256:<digest> AS build
# Resolve the current digest with: docker buildx imagetools inspect node:26-alpine

FROM node:26-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
# scripts/lib/*.d.mts provides the type declarations for the retained simplemdm.mjs /
# sofa.mjs that src/reports/cli/inputs.ts imports — tsc needs them at build time.
COPY scripts ./scripts
# Apple device-management schema cache — without it the 16 schema tools
# silently degrade to a small curated fallback set.
COPY data ./data
RUN npm run build
RUN npm prune --omit=dev

FROM node:26-alpine

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
COPY --from=build --chown=node:node /app/data ./data

# Optional report toolchain. The MCP server (dist/index.js) does NOT need any of
# this; it lets `node scripts/logs-audit.mjs --format all` render the dossier
# in-container: pandoc (md→html/docx), WeasyPrint (html→pdf with footer page
# numbers), plus base fonts. Bundling the host-side audit scripts too.
RUN apk add --no-cache pandoc-cli weasyprint font-dejavu fontconfig
COPY --chown=node:node scripts ./scripts

# The report tools (run_fleet_audit / run_device_logs_audit / run_inventory_report)
# write under /app/reports; /app itself is root-owned, so pre-create it for the
# node user. Mount a host dir here (-v "$PWD/reports:/app/reports") to keep the
# generated reports after the container exits.
# Same for /app/audit_log (write-safety audit trail, MCP_WRITE_AUDIT_DIR default):
# without the pre-create, audit writes silently degrade to stderr warnings.
# Mount it (-v "$PWD/audit_log:/app/audit_log") so the audit trail survives the
# per-session --rm container.
RUN mkdir -p /app/reports /app/audit_log && chown node:node /app/reports /app/audit_log

USER node

CMD ["node", "dist/index.js"]
