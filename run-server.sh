#!/usr/bin/env bash
# Run easy-german as a production server, bound to loopback only.
#
# This intentionally does NOT use `python3 app.py` (Werkzeug dev server +
# debugger). gunicorn imports `app:app` directly and never runs app.py's
# __main__ block, so the debugger can't be reached.
#
# Public exposure is handled separately by the Cloudflare tunnel
# (run-tunnel.sh) — this process only listens on 127.0.0.1.
#
#   --workers 1   each worker loads its own copy of the Whisper model into
#                 RAM; more workers = multiplied memory use.
#   --timeout 0   transcription routinely runs longer than gunicorn's
#                 default 30s; without this, requests get killed mid-run.
set -euo pipefail
cd "$(dirname "$0")"

# Make sure the frontend is built (Flask serves frontend/dist/).
if [ ! -d frontend/dist ]; then
  echo "frontend/dist not found — building..."
  (cd frontend && npm install && npm run build)
fi

exec gunicorn --workers 1 --timeout 0 --bind 127.0.0.1:5001 app:app
