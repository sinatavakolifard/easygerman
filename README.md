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

## Requirements

- Python 3.9+
- Node.js 18+ (only for the web frontend)
- `ffmpeg` available on your `PATH` (faster-whisper needs it to decode audio)

## Install

```bash
# Backend
pip install -r requirements.txt
python -m spacy download de_core_news_sm

# Frontend (only needed for the web app)
cd frontend && npm install
```

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

> **Security note:** never expose `python3 app.py` directly to a network — its `__main__` block binds loopback with the debugger off on purpose. Put a reverse proxy or tunnel in front (see `run-server.sh` / `run-tunnel.sh` for the Cloudflare-tunnel setup used for the live deployment).

## Project layout

```
easy_german.py     # CLI pipeline (transcribe → lemmatize → filter → rank → translate → write)
app.py             # Flask JSON API + static file/SPA server
db.py              # SQLite schema + init (users, extractions, vocab_entries)
reextract.py       # CLI to rebuild stored vocab rows with the current filter logic
requirements.txt   # Python deps
run-server.sh      # Build + run gunicorn (loopback)
run-tunnel.sh      # Cloudflare named tunnel
frontend/          # React 18 + Vite + React Router 6 SPA
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
