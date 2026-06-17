---
name: deploy
description: Run easy-german locally (dev) or deploy it publicly (gunicorn + Cloudflare tunnel + auto-deploy supervisor). Use when starting the app, building the frontend, serving over the network, configuring the tunnel, or running the restricted read-only second host.
---

# Running & deploying easy-german

Two-tier app: Flask (`app.py`) is a JSON API + static-file server; the UI is a React + Vite SPA in `frontend/` (built to `frontend/dist/`).

## Dev workflow — two processes

```
python3 app.py                              # Flask on :5001 (API + audio)
cd frontend && npm install && npm run dev   # Vite on :5173 (open this)
```

Editing `frontend/src/...` hot-reloads on `:5173` instantly. `:5001` keeps showing whatever was last `npm run build`'d (or 503s if there's no build yet) — this is fine and expected. The Vite dev server transpiles TS without type-checking, so run `cd frontend && npm run typecheck` (or rely on `npm run build`) to catch type errors.

## Production — single process

Build once, run Flask:

```
cd frontend && npm run build                # outputs frontend/dist/
python3 app.py                              # serves API + dist/ together (loopback, debugger off)
```

**Never serve `python3 app.py` to a network.** The `__main__` block binds `127.0.0.1` with `debug=False` precisely so an accidental run isn't exposed (the Werkzeug debugger is a remote-code-execution vector). For LAN dev (e.g. testing from a phone), flip the commented `host="0.0.0.0"` line — but that's dev only, never the public path.

For real serving, use gunicorn — it imports `app:app` directly and never runs the `__main__` block, so the debugger can't be reached:

```
gunicorn --workers 1 --timeout 0 --bind 127.0.0.1:5001 app:app
```

`--workers 1` because each worker holds its own copy of the Whisper model in RAM; `--timeout 0` because transcription routinely runs longer than the default 30 s. Bind loopback only and let the tunnel reach in.

## Live deployment — laptop as host, public at `https://easygerman.sinacodes.de`

- `run-server.sh` — builds `frontend/dist/` if missing, then runs the gunicorn line above (loopback only).
- `run-tunnel.sh` — `cloudflared tunnel run easy-german`, the named Cloudflare tunnel. Makes an *outbound* connection to Cloudflare, so no router ports are opened and the home IP stays hidden; Cloudflare terminates HTTPS with an auto-issued cert.
- `auto-deploy.sh` — one-command supervisor: launches `run-server.sh` + `run-tunnel.sh` (backgrounded, PIDs tracked) and every `INTERVAL` seconds (default 300) `git fetch`es `$REMOTE/$BRANCH` (default `origin/main`). Each service's stdout+stderr is labeled per line (`[server]` / `[tunnel]`) on the console and tee'd to `data/logs/{server,tunnel}.log` (gitignored under `data/`); the redirect uses a process substitution (`> >(prefix … | tee …)`) rather than a pipe so `$!` stays the service's own PID and `kill`/`wait` keep working. On a **clean fast-forward** it stops the services, `git pull`s, `rm -rf frontend/dist`, rebuilds (`npm install && npm run build`), and restarts them; otherwise it leaves them running. It only pulls when strictly behind (`git merge-base --is-ancestor` guard) so unpushed/diverged local commits don't trigger a restart loop, restarts either service if it dies between checks, and traps INT/TERM to tear both down. Run via `caffeinate -s ./auto-deploy.sh` on a laptop. A failed build leaves `dist` missing (logged) — `run-server.sh` retries the build on next start, and the `tsc` gate means a type error blocks the deploy.
- Tunnel config lives outside the repo in `~/.cloudflared/`: `config.yml` (maps `easygerman.sinacodes.de` → `http://localhost:5001`, 404 fallback) + `<tunnel-id>.json` credentials (secret, never commit). Created via `cloudflared tunnel login` → `cloudflared tunnel create easy-german` → `cloudflared tunnel route dns easy-german easygerman.sinacodes.de`.
- Both processes only run while the laptop is awake/online; `caffeinate -s` keeps it from sleeping. Not yet daemonised (no launchd service) and no Cloudflare Access wall in front — the app's own email/password auth is the only gate.

## Restricted second host (same URL)

The tunnel URL is tied to the named tunnel + DNS, not to a machine, so a second machine can serve the same `easygerman.sinacodes.de` when the primary is offline — *not both at once*, since each host has its own SQLite DB. Run that host with `EASY_GERMAN_READONLY=1` (exported, or in its local dotenv file) for a read-only profile: login, browse the saved library, read/star words — no upload, audio, re-extract, or delete (see **Feature flags** in `CLAUDE.md`). It needs `data/easy-german.db` copied over so there are words to read, but not `data/audio/` while audio is disabled.

## Alternatives

- Zero-config quick tunnel: `cloudflared tunnel --url http://localhost:5001` (random `*.trycloudflare.com` URL).
- On a VPS: Caddy with `reverse_proxy localhost:5001` auto-issues a Let's Encrypt cert.
