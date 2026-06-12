# easy-german

Extract learning-worthy German vocabulary from podcast audio and get a Markdown vocab list with English translations, gendered articles, and example sentences in context.

It comes in two flavours:

- **CLI** (`easy_german.py`) — point it at an audio file, get a Markdown table back.
- **Web app** (`app.py` + `frontend/`) — a React SPA on top of a Flask JSON API, with accounts, a saved library of past extractions, and individually favourited words.

## How it works

The pipeline (`easy_german.py`) runs the audio through six stages:

1. **Transcribe** — [`faster-whisper`](https://github.com/SYSTRAN/faster-whisper) (German, VAD filter on; default model `medium`).
2. **Tokenize / lemmatize** — spaCy `de_core_news_sm`. Nouns get a gendered article (`der`/`die`/`das`) from the most common observed gender; stubborn compound plurals are singularized heuristically so plural and singular mentions collapse into one entry.
3. **Filter** — keep nouns, verbs, adjectives, and adverbs; drop stopwords, proper nouns, English bleed-through, and words that are too common or too rare for the chosen difficulty level (using [`wordfreq`](https://github.com/rspeer/wordfreq) zipf scores).
4. **Rank** — score by `count × rarity`, take the top N, then re-sort into the audio's original order.
5. **Translate** — [`deep-translator`](https://github.com/nidhaloff/deep-translator) (Google) translates each lemma and its example sentence to English.
6. **Write** — a Markdown table: `German | POS | Count | Meaning | Example`.

Difficulty levels (`--level`) map to a frequency ceiling: `A2+`, `B1+`, `B2+` (default), `C1+` — higher levels keep rarer words.

## Prerequisites

Three system tools are needed on every OS: **Python 3.9+**, **Node.js 18+** (for the web frontend), and **ffmpeg** (faster-whisper decodes audio through it). For the public deployment you also need **cloudflared**. Install them with your platform's package manager.

### macOS (Homebrew)

```bash
brew install python node ffmpeg
brew install cloudflared            # only for public deployment
```

### Debian / Ubuntu

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip ffmpeg nodejs npm git
```

```bash
# cloudflared (Cloudflare's apt repo):
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared
```

> Ubuntu/Debian's `nodejs` can be old. If `npm run build` complains about the Node version, install Node 18+ via [nvm](https://github.com/nvm-sh/nvm) or [NodeSource](https://github.com/nodesource/distributions).

### Arch / Manjaro

```bash
sudo pacman -S --needed python python-pip python-virtualenv ffmpeg nodejs npm git
```

```bash
# cloudflared is in the AUR:
pamac build cloudflared             # Manjaro
# or:  yay -S cloudflared
```

### Fedora / RHEL

```bash
sudo dnf install -y python3 python3-pip python3-virtualenv nodejs npm git
sudo dnf install -y ffmpeg          # may need RPM Fusion enabled first
```

### Any Linux (no package): cloudflared static binary

```bash
mkdir -p ~/.local/bin
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -o ~/.local/bin/cloudflared && chmod +x ~/.local/bin/cloudflared
# make sure ~/.local/bin is on your PATH
```

## Install

The same steps on every platform. A virtual environment is recommended everywhere and **required** on Arch/Manjaro and recent Debian/Fedora (PEP 668 blocks system-wide `pip install`):

```bash
git clone <your-repo-url> easy-german
cd easy-german

python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate

pip install -r requirements.txt
python -m spacy download de_core_news_sm

# Frontend (only needed for the web app)
cd frontend && npm install && npm run build && cd ..
```

The first transcription downloads the Whisper model weights (a few hundred MB for `medium`) to your cache automatically. Keep the venv active (`source .venv/bin/activate`) whenever you run the CLI or the server.

## CLI usage

```bash
python easy_german.py AUDIO [-o OUT] [--model SIZE] [--min-count N] [--top N]
                      [--max-zipf F | --level {A2+,B1+,B2+,C1+}]
                      [--save-transcript PATH] [-v]
```

Examples:

```bash
# Basic run — writes vocab-<audio-stem>.md
python easy_german.py episode.mp3

# B1 learner, keep words appearing at least twice, top 30
python easy_german.py episode.mp3 --level B1+ --min-count 2 --top 30

# Keep every word that passes the filters, and save the transcript
python easy_german.py episode.mp3 --top 0 --save-transcript transcript.txt
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `-o, --output` | `vocab-<audio-stem>.md` | Output Markdown path |
| `--model` | `medium` | Whisper model size (`tiny`…`large`) |
| `--min-count` | `1` | Drop words appearing fewer than N times |
| `--top` | `50` | Keep top N words (`0` = no cap) |
| `--level` | `B2+` | CEFR-ish difficulty preset (sets `--max-zipf`) |
| `--max-zipf` | `4.0` | Frequency ceiling (lower = rarer words only) |
| `--save-transcript` | — | Also write the raw transcript to a file |
| `-v` | — | Verbose logging |

## Web app

The web app adds accounts, a persistent library of past extractions, re-extraction with new settings, and individually saved words — all backed by SQLite.

### Development

Run two processes:

```bash
python3 app.py                              # Flask API + audio on :5001
cd frontend && npm run dev                  # Vite dev server on :5173  ← open this
```

Vite proxies `/api` and `/audio` to the Flask backend, so the browser sees a single origin. Edits under `frontend/src/` hot-reload instantly.

### Production

Build the frontend once, then serve everything from Flask via gunicorn:

```bash
cd frontend && npm run build                # outputs frontend/dist/
gunicorn --workers 1 --timeout 0 --bind 127.0.0.1:5001 app:app
```

`--workers 1` because each worker loads its own copy of the Whisper model; `--timeout 0` because transcription often runs longer than gunicorn's default 30s.

> **Security note:** never expose `python3 app.py` directly to a network — its `__main__` block binds loopback with the debugger off on purpose. Put a reverse proxy or tunnel in front (see below).

## Public deployment (Cloudflare Tunnel)

The live site (`https://easygerman.sinacodes.de`) is just a machine running gunicorn on loopback, with a **named Cloudflare tunnel** making an *outbound* connection to Cloudflare — no router ports opened, the home IP stays hidden, and Cloudflare terminates HTTPS. Two helper scripts:

- `run-server.sh` — builds `frontend/dist/` if missing, then runs gunicorn on `127.0.0.1:5001`.
- `run-tunnel.sh` — `cloudflared tunnel run easy-german`.

### One-time tunnel creation

Done once, on any machine (this needs `CERT_PEM` from login):

```bash
cloudflared tunnel login
cloudflared tunnel create easy-german
cloudflared tunnel route dns easy-german easygerman.sinacodes.de
```

This writes `~/.cloudflared/config.yml`, `~/.cloudflared/<tunnel-id>.json`, and `CERT_PEM`.

### Running it — macOS

Keep the laptop awake with `caffeinate`, one process per terminal (activate the venv first):

```bash
source .venv/bin/activate
caffeinate -s ./run-server.sh        # terminal 1
caffeinate -s ./run-tunnel.sh        # terminal 2
```

### Running it — Linux (systemd)

On Linux use **systemd user services** so both processes auto-start, restart on crash, and survive logout — no `caffeinate` needed. Adjust the paths if your clone isn't at `~/easy-german`.

`~/.config/systemd/user/easy-german.service`

```ini
[Unit]
Description=easy-german gunicorn server
After=network-online.target

[Service]
WorkingDirectory=%h/easy-german
ExecStart=%h/easy-german/.venv/bin/gunicorn --workers 1 --timeout 0 --bind 127.0.0.1:5001 app:app
Restart=on-failure

[Install]
WantedBy=default.target
```

`~/.config/systemd/user/easy-german-tunnel.service`

```ini
[Unit]
Description=easy-german Cloudflare tunnel
After=easy-german.service
Requires=easy-german.service

[Service]
ExecStart=%h/.local/bin/cloudflared tunnel --config %h/.cloudflared/config.yml run
Restart=on-failure

[Install]
WantedBy=default.target
```

> Set `ExecStart` to wherever `cloudflared` lives — `/usr/bin/cloudflared` if installed from a repo (Arch/Debian), or `%h/.local/bin/cloudflared` for the static binary.

```bash
systemctl --user daemon-reload
systemctl --user enable --now easy-german easy-german-tunnel
loginctl enable-linger "$USER"       # keep services running while logged out
# logs:
journalctl --user -u easy-german -f
```

### Moving the deployment to another machine

The public URL is tied to the tunnel + DNS, **not** to a machine — any host can serve it (one at a time; each host has its own SQLite DB). To migrate:

1. Install the prerequisites and the app on the new host (sections above).
2. Copy the tunnel credentials into `~/.cloudflared/`:
   - `<tunnel-id>.json` — the secret, **required** to run. Transfer securely, never commit.
   - `config.yml`
3. **Fix the absolute `credentials-file:` path** in `config.yml` to the new host's home (e.g. `/home/<user>/.cloudflared/<tunnel-id>.json`).
4. Run the tunnel **by UUID**, which needs no `CERT_PEM`:
   ```bash
   cloudflared tunnel --config ~/.cloudflared/config.yml run
   ```
   `CERT_PEM` is only needed to *create/manage* tunnels, or to run *by name* (as `run-tunnel.sh` does). Copy `CERT_PEM` too if you keep the by-name script.
5. To carry over accounts/library, copy `data/easy-german.db` (plus `data/audio/` for a full host, and `data/session_token` to keep existing logins valid).

### Per-host feature flags (read-only mode)

The same code can run a **full** host and a **restricted** one. Flags — set as environment variables, or in a `python-dotenv` file in the project root — gate four actions **server-side**: `upload`, `audio`, `reextract`, `delete`. A restricted host keeps login, reading past words, and starring them.

```bash
# restricted host — disable all four (login + read + star only):
echo "EASY_GERMAN_READONLY=1" > DOTENV_FILE
```

Granular overrides take precedence over the coarse switch: `EASY_GERMAN_UPLOAD`, `EASY_GERMAN_AUDIO`, `EASY_GERMAN_REEXTRACT`, `EASY_GERMAN_DELETE`. For example `EASY_GERMAN_READONLY=1 EASY_GERMAN_AUDIO=1` blocks everything but audio playback. An exported variable wins over the dotenv file. The `DOTENV_FILE` file is gitignored, so it stays per-host; a restricted host needs `data/easy-german.db` but not `data/audio/`.

## Project layout

```
easy_german.py     # CLI pipeline (transcribe → lemmatize → filter → rank → translate → write)
app.py             # Flask JSON API + static file/SPA server
db.py              # SQLite schema + init (users, extractions, vocab_entries)
reextract.py       # CLI to rebuild stored vocab rows with the current filter logic
requirements.txt   # Python deps
run-server.sh      # Build + run gunicorn (loopback)
run-tunnel.sh      # Cloudflare named tunnel
frontend/          # React 18 + Vite + React Router 6 SPA (TypeScript, strict)
data/              # SQLite DB, audio, session token (gitignored)
CLAUDE.md          # Detailed architecture / implementation notes
```

## Data & persistence

Logged-in extractions are stored in SQLite at `data/easy-german.db` (users, extractions, and per-word `vocab_entries`). Audio is saved under `data/audio/`. Anonymous uploads are processed but not persisted and are swept after an hour. The entire `data/` directory is gitignored.

`reextract.py` rebuilds the stored vocab rows for already-saved extractions using the current filter logic — handy after tuning constants like the frequency threshold or kept parts of speech:

```bash
python reextract.py --user you@example.com --level B1+ --dry-run
```

## More detail

See [`CLAUDE.md`](./CLAUDE.md) for in-depth notes on the filtering heuristics, the API surface, the frontend component structure, and deployment.
