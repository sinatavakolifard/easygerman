#!/usr/bin/env bash
# Start the Cloudflare tunnel that publishes easy-german at
# https://easygerman.sinacodes.de.
#
# The app must already be listening on 127.0.0.1:5001 (run run-server.sh
# in another terminal first). The tunnel makes an OUTBOUND connection to
# Cloudflare — no router ports are opened, and your home IP stays hidden.
#
# Config + credentials live in ~/.cloudflared/ (config.yml, <tunnel-id>.json).
set -euo pipefail
exec cloudflared tunnel run easy-german
