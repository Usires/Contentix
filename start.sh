#!/bin/bash
# start.sh — thin wrapper around restart.sh.
#
# Use restart.sh directly for full control. This wrapper exists for
# muscle-memory callers ("just start it").
exec "$(dirname "$0")/restart.sh"
