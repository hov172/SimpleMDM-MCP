#!/usr/bin/env bash
# Register SimpleMDM-MCP with Claude Code (read-only).
# Replace YOUR_API_KEY and the absolute path before running.

claude mcp add simplemdm \
  -e SIMPLEMDM_API_KEY=YOUR_API_KEY \
  -- node /absolute/path/to/SimpleMDM-MCP/dist/index.js

# To enable write tools (lock/sync/restart/wipe/etc.), add:
#   -e SIMPLEMDM_ALLOW_WRITES=true
#
# Writes still prompt per call via MCP `destructiveHint` annotations.

# Verify the connection:
#   claude mcp list
