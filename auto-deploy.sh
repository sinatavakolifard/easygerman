#!/usr/bin/env bash
# auto-deploy.sh — run easy-german and keep it up to date.
#
# Starts the gunicorn server (run-server.sh) and the Cloudflare tunnel
# (run-tunnel.sh), then every 5 minutes checks GitHub for new commits on the
# tracked branch. When there are updates it pulls them, removes and rebuilds
# frontend/dist, and restarts the server + tunnel. When there are none it just
# keeps the running processes alive (and restarts either one if it has died).
#
# Stop everything with Ctrl-C (or `kill` this script) — it tears down the
# server and tunnel on the way out.
#
# Tunables (env vars): REMOTE (default origin), BRANCH (default main),
# INTERVAL seconds (default 300).
#
# Tip: on a laptop, wrap with caffeinate so it doesn't sleep:
#   caffeinate -s ./auto-deploy.sh

set -uo pipefail
cd "$(dirname "$0")"

REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
INTERVAL="${INTERVAL:-300}"
LOG_DIR="${LOG_DIR:-data/logs}"

SERVER_PID=""
TUNNEL_PID=""

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Read stdin line by line and prefix each line with [label]; used to label and
# interleave the server/tunnel output on the console.
prefix() {
  local label="$1"
  while IFS= read -r line; do
    printf '[%s] %s\n' "$label" "$line"
  done
}

start_services() {
  mkdir -p "$LOG_DIR"
  # Route each service's stdout+stderr through prefix() (labels every line)
  # and tee (also appends to a per-service log file). The redirect uses a
  # process substitution rather than a pipe, so `$!` is still run-server.sh's
  # / run-tunnel.sh's own PID — kill/wait in stop_services keep working.
  log "Starting server (run-server.sh) → console + $LOG_DIR/server.log"
  ./run-server.sh > >(prefix server | tee -a "$LOG_DIR/server.log") 2>&1 &
  SERVER_PID=$!
  log "Starting tunnel (run-tunnel.sh) → console + $LOG_DIR/tunnel.log"
  ./run-tunnel.sh > >(prefix tunnel | tee -a "$LOG_DIR/tunnel.log") 2>&1 &
  TUNNEL_PID=$!
  log "Running — server PID=$SERVER_PID, tunnel PID=$TUNNEL_PID"
}

stop_services() {
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  # Wait for them to actually exit so ports/PIDs are freed before a restart.
  [ -n "$TUNNEL_PID" ] && wait "$TUNNEL_PID" 2>/dev/null
  [ -n "$SERVER_PID" ] && wait "$SERVER_PID" 2>/dev/null
  TUNNEL_PID=""
  SERVER_PID=""
}

services_running() {
  [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null \
    && [ -n "$TUNNEL_PID" ] && kill -0 "$TUNNEL_PID" 2>/dev/null
}

ensure_running() {
  if ! services_running; then
    if [ -n "$SERVER_PID$TUNNEL_PID" ]; then
      log "A service is not running — restarting both."
    fi
    stop_services   # clean up any survivor
    start_services
  fi
}

rebuild_frontend() {
  log "Removing frontend/dist and rebuilding…"
  rm -rf frontend/dist
  if (cd frontend && npm install && npm run build); then
    log "Frontend rebuilt."
  else
    log "WARNING: frontend build failed — dist is missing; run-server.sh will retry the build on start."
  fi
}

check_for_updates() {
  if ! git fetch --quiet "$REMOTE" "$BRANCH"; then
    log "git fetch failed; will retry next cycle."
    return
  fi
  local local_head remote_head
  local_head=$(git rev-parse HEAD)
  remote_head=$(git rev-parse "$REMOTE/$BRANCH")
  if [ "$local_head" = "$remote_head" ]; then
    log "Up to date ($local_head)."
    return
  fi
  # Only pull when we are strictly behind (a clean fast-forward). If HEAD is
  # ahead of or diverged from the remote (e.g. local unpushed commits), leave
  # the running services untouched instead of restarting every cycle.
  if ! git merge-base --is-ancestor "$local_head" "$remote_head"; then
    log "Local is ahead of / diverged from $REMOTE/$BRANCH — not pulling."
    return
  fi
  log "Update found: $local_head -> $remote_head. Pulling…"
  stop_services
  if git pull --ff-only "$REMOTE" "$BRANCH"; then
    rebuild_frontend
  else
    log "WARNING: git pull --ff-only failed; restarting with current code."
  fi
  # ensure_running below brings the (now stopped) services back up.
}

cleanup() {
  log "Shutting down…"
  stop_services
  exit 0
}
trap cleanup INT TERM

log "auto-deploy starting (remote=$REMOTE branch=$BRANCH interval=${INTERVAL}s)"
# First cycle: pick up any updates pushed while we were down, then start.
check_for_updates
ensure_running

while true; do
  sleep "$INTERVAL"
  log "Checking for updates…"
  check_for_updates
  ensure_running
done
