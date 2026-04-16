#!/usr/bin/env bash
# Build and run SimpleMDM-MCP in Docker, with the version baked into
# org.opencontainers.image.version label so `docker inspect` shows what's installed.

set -euo pipefail

V=$(node -p "require('./package.json').version")

docker build --build-arg VERSION="$V" -t "simplemdm-mcp:$V" .

# Run with an .env file (recommended):
docker run --rm -i --env-file .env "simplemdm-mcp:$V"

# Or pass env vars directly:
# docker run --rm -i \
#   -e SIMPLEMDM_API_KEY=your-api-key-here \
#   "simplemdm-mcp:$V"

# Inspect the version label of the built image:
# docker inspect "simplemdm-mcp:$V" --format '{{ index .Config.Labels "org.opencontainers.image.version" }}'
