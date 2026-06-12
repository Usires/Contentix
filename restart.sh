#!/bin/bash
# restart.sh — robust restart of the locally-running Contentix process.
#
# What it does:
#   1. Stop any existing `node index.js` running from THIS directory (PID-file
#      if present, else pgrep fallback).
#   2. Wait for the port to be free (max 5 s).
#   3. Start a fresh process detached from this shell, write its PID to
#      ./contentix.pid for the next restart.
#   4. Poll /api/health up to 10 s and report status.
#
# Why this matters: the old script used `pkill -f "node.*contentix"` and a
# bare `&`, which made it hard to track and easy to leave zombie processes.
# This version is idempotent: running it twice in a row keeps exactly one
# Contentix process.

set -euo pipefail

cd "$(dirname "$0")"
PID_FILE="$(pwd)/contentix.pid"
LOG_FILE="$(pwd)/contentix.log"
HEALTH_URL="http://localhost:${PORT:-3038}/api/health"

log() { printf '[restart] %s\n' "$*"; }

stop_existing() {
  local existing_pid=""
  if [[ -f "$PID_FILE" ]]; then
    existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" 2>/dev/null; then
      log "stopping PID ${existing_pid} (from ${PID_FILE})"
      kill "${existing_pid}" 2>/dev/null || true
    else
      log "stale PID file: ${existing_pid} not alive, removing"
    fi
    rm -f "$PID_FILE"
  fi

  # Find whoever is currently holding the port. pgrep on cmdline alone is
  # unreliable (e.g. plain "node index.js" without full path), so we go via
  # ss/lsof to get the real port owner.
  : "${PORT:=3038}"
  local port_pid=""
  if command -v ss >/dev/null 2>&1; then
    port_pid="$(ss -tlnpH "sport = :${PORT}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
  fi
  if [[ -z "${port_pid}" ]] && command -v lsof >/dev/null 2>&1; then
    port_pid="$(lsof -ti tcp:"${PORT}" 2>/dev/null | head -1 || true)"
  fi
  if [[ -n "${port_pid}" ]]; then
    local port_cmd
    port_cmd="$(ps -o cmd= -p "${port_pid}" 2>/dev/null || true)"
    log "port ${PORT} is held by PID ${port_pid} (${port_cmd}) — stopping"
    kill "${port_pid}" 2>/dev/null || true
  fi

  # Wait for port to free up (max 5 s).
  for _ in $(seq 1 10); do
    if ! ss -tlnH "sport = :${PORT}" 2>/dev/null | grep -q LISTEN; then
      return 0
    fi
    sleep 0.5
  done
  log "warning: port ${PORT} still busy after 5 s"
}

start_fresh() {
  # Load .env into the shell so node inherits VIDIQ_API_KEY, PORT, etc.
  if [[ -f .env ]]; then
    log "loading .env"
    set -a; . ./.env; set +a
  elif [[ -f .env.example ]]; then
    log "no .env found, falling back to .env.example (override VIDIQ_API_KEY before any real run)"
    set -a; . ./.env.example; set +a
  fi
  : "${PORT:=3038}"
  : "${VIDIQ_API_KEY:?VIDIQ_API_KEY is required (set it in .env)}"

  log "starting fresh node process on port ${PORT}"
  nohup node index.js >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  log "PID $(cat "$PID_FILE") written to ${PID_FILE}"
}

wait_healthy() {
  log "polling ${HEALTH_URL} (max 10 s)"
  for _ in $(seq 1 20); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      local ver
      ver="$(curl -fsS "$HEALTH_URL" | grep -o '"version":"[^"]*"' || echo 'unknown')"
      log "✅ healthy (${ver})"
      return 0
    fi
    sleep 0.5
  done
  log "❌ did not become healthy within 10 s — check ${LOG_FILE}"
  return 1
}

stop_existing
start_fresh
wait_healthy
